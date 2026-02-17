/**
 * Admin Routes
 * Dashboard, users, orders, email logs, exports, bulk charge
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { query, queryOne, execute, isPostgres } = require('../config/database');
const { requireAdmin } = require('../middleware/auth');
const { logEmail } = require('../utils/helpers');
const emailService = require('../services/emailService');

// Admin login page
router.get('/login', (req, res) => {
    if (req.session.adminId) {
        res.redirect('/admin/dashboard');
    } else {
        res.sendFile(path.join(__dirname, '..', 'views', 'admin', 'login.html'));
    }
});

// Admin login handler
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    console.log('\n=== Admin Login Attempt ===');
    console.log('Email:', email);
    console.log('Password provided:', password ? 'Yes' : 'No');
    
    try {
        // Normalize email (trim and lowercase)
        const normalizedEmail = email ? email.trim().toLowerCase() : '';
        
        const admin = await queryOne('SELECT * FROM admins WHERE LOWER(TRIM(email)) = $1', [normalizedEmail]);
        
        if (!admin) {
            console.log('✗ Admin not found for email:', normalizedEmail);
            // List available admins for debugging (remove in production)
            const allAdmins = await query('SELECT email FROM admins LIMIT 5');
            console.log('Available admin emails:', allAdmins.map(a => a.email).join(', '));
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        console.log('✓ Admin found:', admin.email);
        console.log('Password hash exists:', !!admin.password);
        
        const match = await bcrypt.compare(password, admin.password);
        console.log('Password match:', match);
        
        if (!match) {
            console.log('✗ Password mismatch');
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        console.log('✓ Login successful');
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        res.json({ success: true, redirect: '/admin/dashboard' });
    } catch (err) {
        console.error('Admin login error:', err);
        console.error('Error stack:', err.stack);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin dashboard
router.get('/dashboard', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'admin', 'dashboard.html'));
});

// Get admin statistics
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const stats = {};
        
        const r1 = await query('SELECT COUNT(*) as total FROM users');
        stats.totalBackers = parseInt(r1[0].total);
        
        const r2 = await query('SELECT COUNT(*) as total FROM orders WHERE paid = 1');
        stats.completedOrders = parseInt(r2[0].total);
            
        const r3 = await query('SELECT SUM(total) as revenue FROM orders WHERE paid = 1');
        stats.totalRevenue = parseFloat(r3[0].revenue) || 0;
                
        const r4 = await query('SELECT COUNT(*) as total FROM orders WHERE paid = 0');
        stats.pendingOrders = parseInt(r4[0].total);
                    
        res.json(stats);
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all users
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = await query('SELECT id, email, backer_number, backer_name, reward_title, pledge_amount, has_completed FROM users ORDER BY backer_number');
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all orders
router.get('/orders', requireAdmin, async (req, res) => {
    try {
        const orders = await query(`SELECT o.*, u.email, u.backer_number, u.backer_name 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC`);
        res.json(orders);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get email logs
router.get('/email-logs', requireAdmin, async (req, res) => {
    try {
        const emailLogs = await query(`SELECT el.*, o.id as order_id_from_orders, u.email as user_email_from_users, u.backer_name
            FROM email_logs el
            LEFT JOIN orders o ON el.order_id = o.id
            LEFT JOIN users u ON el.user_id = u.id
            ORDER BY el.sent_at DESC LIMIT 500`);
        
        const stats = {};
        const totalEmails = emailLogs.length;
        const successfulEmails = emailLogs.filter(log => log.status === 'sent').length;
        const failedEmails = emailLogs.filter(log => log.status === 'failed').length;
        
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const last24Hours = emailLogs.filter(log => new Date(log.sent_at) > twentyFourHoursAgo).length;

        stats.totalEmails = totalEmails;
        stats.successfulEmails = successfulEmails;
        stats.failedEmails = failedEmails;
        stats.last24Hours = last24Hours;

        res.json({ logs: emailLogs, stats: stats });
    } catch (err) {
        console.error('Error fetching email logs:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get single order (with parsed JSON)
router.get('/orders/:id', requireAdmin, async (req, res) => {
    try {
        const order = await queryOne(`SELECT o.*, u.email, u.backer_number, u.backer_name 
            FROM orders o LEFT JOIN users u ON o.user_id = u.id WHERE o.id = $1`, [req.params.id]);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        try {
            order.new_addons = order.new_addons ? JSON.parse(order.new_addons) : [];
            order.shipping_address = order.shipping_address ? JSON.parse(order.shipping_address) : {};
            order.comped_items = order.comped_items ? JSON.parse(order.comped_items) : [];
        } catch (_) {}
        
        res.json(order);
    } catch (err) {
        console.error('Error fetching order:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update comped items on an order
router.put('/orders/:id/comped-items', requireAdmin, async (req, res) => {
    const orderId = req.params.id;
    let compedItems = Array.isArray(req.body.compedItems) ? req.body.compedItems : [];
    
    // Server-enforce free/no-shipping
    compedItems = compedItems.map(item => ({
        id: item.id || null,
        name: String(item.name || '').slice(0, 200),
        quantity: Math.max(0, parseInt(item.quantity || 0, 10)),
        price: 0,
        weight: 0,
        excludeFromShipping: true,
        note: item.note ? String(item.note).slice(0, 500) : undefined
    })).filter(i => i.quantity > 0 && i.name);

    try {
        await execute(`UPDATE orders SET comped_items = $1, 
            updated_by_admin_id = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`, 
            [JSON.stringify(compedItems), req.session.adminId, orderId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating comped items:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Export users to CSV
router.get('/export/users', requireAdmin, async (req, res) => {
    try {
        const users = await query('SELECT * FROM users ORDER BY backer_number');
        
        // Create CSV
        let csv = 'Backer Number,Email,Name,Reward Tier,Pledge Amount,Completed,Created\n';
        users.forEach(user => {
            csv += `${user.backer_number || ''},`;
            csv += `"${user.email || ''}",`;
            csv += `"${user.backer_name || ''}",`;
            csv += `"${user.reward_title || ''}",`;
            csv += `${user.pledge_amount || 0},`;
            csv += `${user.has_completed ? 'Yes' : 'No'},`;
            csv += `"${user.created_at || ''}"\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=maya-users-export.csv');
        res.send(csv);
    } catch (err) {
        console.error('Error exporting users:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Export orders to CSV
router.get('/export/orders', requireAdmin, async (req, res) => {
    try {
        // First get all available add-ons to create columns
        const availableAddons = await query('SELECT id, name FROM addons ORDER BY name');
        
        const orders = await query(`SELECT o.*, u.email, u.backer_number, u.backer_name 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC`);
        
        // Build CSV header with add-on columns and detailed shipping info
        let csv = 'Order ID,Backer Number,Backer Name,Email,';
        
        // Add column for each add-on
        availableAddons.forEach(addon => {
            csv += `"${addon.name}",`;
        });
        
        csv += 'Add-ons Subtotal,Shipping Cost,Total,Paid,Payment Status,Stripe Payment Intent ID,';
        csv += 'Full Name,Address Line 1,Address Line 2,City,State,Postal Code,Country,Phone,';
        csv += 'Created Date,Comped Items\n';
        
        // Build rows
        orders.forEach(order => {
            const addons = order.new_addons ? JSON.parse(order.new_addons) : [];
            const address = order.shipping_address ? JSON.parse(order.shipping_address) : {};
            const comped = order.comped_items ? JSON.parse(order.comped_items) : [];
            
            csv += `${order.id},`;
            csv += `${order.backer_number || ''},`;
            csv += `"${order.backer_name || ''}",`;
            csv += `"${order.email || address.email || ''}",`;
            
            // For each available add-on, output quantity (0 if not in order)
            availableAddons.forEach(availableAddon => {
                const purchased = addons.find(a => a.id === availableAddon.id || a.name === availableAddon.name);
                csv += `${purchased ? purchased.quantity : 0},`;
            });
            
            csv += `${order.addons_subtotal || 0},`;
            csv += `${order.shipping_cost || 0},`;
            csv += `${order.total || 0},`;
            csv += `${order.paid ? 'Yes' : 'No'},`;
            csv += `"${order.payment_status || 'pending'}",`;
            csv += `"${order.stripe_payment_intent_id || ''}",`;
            
            // Detailed shipping address fields
            csv += `"${address.fullName || address.name || ''}",`;
            csv += `"${address.addressLine1 || address.address1 || ''}",`;
            csv += `"${address.addressLine2 || address.address2 || ''}",`;
            csv += `"${address.city || ''}",`;
            csv += `"${address.state || ''}",`;
            csv += `"${address.postalCode || address.postal || ''}",`;
            csv += `"${address.country || ''}",`;
            csv += `"${address.phone || ''}",`;
            
            csv += `"${order.created_at || ''}",`;
            
            // Format comped items
            const compedStr = comped.map(c => `${c.name} x${c.quantity}${c.note ? ' (' + c.note + ')' : ''}`).join('; ');
            csv += `"${compedStr}"\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=maya-orders-export.csv');
        res.send(csv);
    } catch (err) {
        console.error('Error exporting orders:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Bulk charge all orders with saved cards
router.post('/bulk-charge-orders', requireAdmin, async (req, res) => {
    console.log('\n=== BULK CHARGE ORDERS REQUEST ===');
    console.log('Admin ID:', req.session.adminId);
    console.log('Timestamp:', new Date().toISOString());
    
    try {
        // Get all orders with saved cards that haven't been charged yet
        const orders = await query(`SELECT * FROM orders 
            WHERE payment_status = 'card_saved' 
            AND paid = 0 
            AND stripe_customer_id IS NOT NULL 
            AND stripe_payment_method_id IS NOT NULL`);

        console.log(`Found ${orders.length} orders with saved cards ready to charge`);

        if (orders.length === 0) {
            console.log('✓ No orders to charge');
            return res.json({ 
                success: true,
                message: 'No orders to charge',
                charged: 0,
                failed: 0,
                total: 0
            });
        }

        const results = {
            charged: [],
            failed: [],
            total: orders.length
        };

        console.log(`\nProcessing ${orders.length} orders...`);

        // Process each order
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            console.log(`\n[${i + 1}/${orders.length}] Processing Order #${order.id}`);
            console.log(`  - Amount: $${order.total}`);
            console.log(`  - Customer: ${order.stripe_customer_id}`);
            console.log(`  - Payment Method: ${order.stripe_payment_method_id}`);
            
            try {
                // Charge the saved card using off-session payment
                const amountInCents = Math.round(order.total * 100);
                console.log(`  - Charging ${amountInCents} cents ($${order.total})...`);
                
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd',
                    customer: order.stripe_customer_id,
                    payment_method: order.stripe_payment_method_id,
                    off_session: true,
                    confirm: true,
                    metadata: {
                        orderId: order.id.toString(),
                        orderType: 'bulk-charge-autodebit',
                        chargedAt: new Date().toISOString()
                    }
                });

                console.log(`  ✓ Payment Intent created: ${paymentIntent.id}`);
                console.log(`  ✓ Status: ${paymentIntent.status}`);

                // Update order status
                await execute(`UPDATE orders 
                    SET paid = 1, 
                        payment_status = 'charged', 
                        stripe_payment_intent_id = $1,
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = $2`, 
                    [paymentIntent.id, order.id]);

                const shippingAddress = JSON.parse(order.shipping_address);
                results.charged.push({
                    orderId: order.id,
                    email: shippingAddress.email,
                    amount: order.total,
                    paymentIntentId: paymentIntent.id
                });

                console.log(`  ✓ Order #${order.id} charged successfully`);

                // Send payment successful email
                try {
                    const emailResult = await emailService.sendPaymentSuccessful(order, paymentIntent.id);
                    await logEmail({
                        orderId: order.id,
                        userId: order.user_id,
                        recipientEmail: shippingAddress.email,
                        emailType: 'payment_success',
                        subject: `Order #${order.id} - Payment Confirmation`,
                        status: emailResult.success ? 'sent' : 'failed',
                        resendMessageId: emailResult.messageId || null,
                        errorMessage: emailResult.error || null
                    });
                } catch (emailError) {
                    console.error(`  ⚠️  Failed to send payment success email for order ${order.id}:`, emailError.message);
                }

            } catch (error) {
                console.error(`  ✗ Failed to charge order ${order.id}`);
                console.error(`    - Error: ${error.message}`);
                console.error(`    - Error type: ${error.type}`);
                console.error(`    - Error code: ${error.code}`);
                
                // Mark as failed
                await execute(`UPDATE orders 
                    SET payment_status = 'charge_failed' 
                    WHERE id = $1`, 
                    [order.id]);

                const shippingAddress = JSON.parse(order.shipping_address);
                results.failed.push({
                    orderId: order.id,
                    email: shippingAddress.email,
                    amount: order.total,
                    error: error.message,
                    errorCode: error.code
                });

                // Send payment failed email
                try {
                    const emailResult = await emailService.sendPaymentFailed(order, error.message, error.code);
                    await logEmail({
                        orderId: order.id,
                        userId: order.user_id,
                        recipientEmail: shippingAddress.email,
                        emailType: 'payment_failed',
                        subject: `Order #${order.id} - Payment Failed`,
                        status: emailResult.success ? 'sent' : 'failed',
                        resendMessageId: emailResult.messageId || null,
                        errorMessage: emailResult.error || null
                    });
                } catch (emailError) {
                    console.error(`  ⚠️  Failed to send payment failed email for order ${order.id}:`, emailError.message);
                }
            }
        }

        // Return summary
        console.log('\n=== BULK CHARGE SUMMARY ===');
        console.log(`Total orders: ${results.total}`);
        console.log(`✓ Successfully charged: ${results.charged.length}`);
        console.log(`✗ Failed: ${results.failed.length}`);
        
        if (results.charged.length > 0) {
            const totalCharged = results.charged.reduce((sum, order) => sum + order.amount, 0);
            console.log(`Total amount charged: $${totalCharged.toFixed(2)}`);
        }
        
        if (results.failed.length > 0) {
            console.log('\nFailed orders:');
            results.failed.forEach(fail => {
                console.log(`  - Order #${fail.orderId}: ${fail.error}`);
            });
        }

        // Send admin summary email
        try {
            const emailResult = await emailService.sendAdminBulkChargeSummary(results);
            await logEmail({
                orderId: null,
                userId: null,
                recipientEmail: process.env.ADMIN_EMAIL,
                emailType: 'admin_bulk_charge_summary',
                subject: `Bulk Charge Summary - ${results.charged.length} Succeeded, ${results.failed.length} Failed`,
                status: emailResult.success ? 'sent' : 'failed',
                resendMessageId: emailResult.messageId || null,
                errorMessage: emailResult.error || null
            });
        } catch (emailError) {
            console.error('⚠️  Failed to send admin bulk charge summary email:', emailError.message);
        }
        
        res.json({
            success: true,
            message: `Bulk charge completed: ${results.charged.length} succeeded, ${results.failed.length} failed`,
            charged: results.charged.length,
            failed: results.failed.length,
            total: results.total,
            totalAmountCharged: results.charged.reduce((sum, order) => sum + order.amount, 0),
            details: results
        });
    } catch (error) {
        console.error('\n✗ Error in bulk charge:', error.message);
        console.error('  - Stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to process bulk charge',
            details: error.message 
        });
    }
});

// Charge a customer's saved card (single order)
router.post('/charge-order/:orderId', requireAdmin, async (req, res) => {
    const orderId = req.params.orderId;
    
    try {
        // Get order details
        const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId]);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        if (!order.stripe_customer_id || !order.stripe_payment_method_id) {
            return res.status(400).json({ error: 'No saved payment method for this order' });
        }
        
        if (order.payment_status === 'charged') {
            return res.status(400).json({ error: 'Order already charged' });
        }
        
        try {
            // Charge the saved card
            const paymentIntent = await stripe.paymentIntents.create({
                amount: Math.round(order.total * 100),
                currency: 'usd',
                customer: order.stripe_customer_id,
                payment_method: order.stripe_payment_method_id,
                off_session: true,
                confirm: true,
                metadata: {
                    orderId: orderId.toString(),
                    orderType: 'pre-order-charged'
                }
            });
            
            // Update order status
            await execute(`UPDATE orders 
                SET paid = 1, 
                    payment_status = 'charged', 
                    stripe_payment_intent_id = $1,
                    updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2`, 
                [paymentIntent.id, orderId]);
            
            // Send payment successful email
            try {
                const shippingAddress = typeof order.shipping_address === 'string' 
                    ? JSON.parse(order.shipping_address) 
                    : order.shipping_address;
                const emailResult = await emailService.sendPaymentSuccessful(order, paymentIntent.id);
                await logEmail({
                    orderId: order.id,
                    userId: order.user_id,
                    recipientEmail: shippingAddress?.email,
                    emailType: 'payment_success',
                    subject: `Order #${order.id} - Payment Confirmation`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            } catch (emailError) {
                console.error('⚠️  Failed to send payment success email:', emailError.message);
            }
            
            res.json({ 
                success: true, 
                paymentIntentId: paymentIntent.id,
                message: `Successfully charged $${order.total.toFixed(2)}`
            });
        } catch (stripeError) {
            console.error('Stripe charge error:', stripeError);
            
            // Update order with failed status
            await execute(`UPDATE orders 
                SET payment_status = 'charge_failed' 
                WHERE id = $1`, 
                [orderId]);
            
            // Send payment failed email
            try {
                const shippingAddress = typeof order.shipping_address === 'string' 
                    ? JSON.parse(order.shipping_address) 
                    : order.shipping_address;
                const emailResult = await emailService.sendPaymentFailed(order, stripeError.message, stripeError.code);
                await logEmail({
                    orderId: order.id,
                    userId: order.user_id,
                    recipientEmail: shippingAddress?.email,
                    emailType: 'payment_failed',
                    subject: `Order #${order.id} - Payment Failed`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            } catch (emailError) {
                console.error('⚠️  Failed to send payment failed email:', emailError.message);
            }
            
            res.status(500).json({ 
                error: 'Failed to charge card: ' + stripeError.message 
            });
        }
    } catch (error) {
        console.error('Error charging order:', error);
        res.status(500).json({ error: 'Failed to process charge' });
    }
});

// ============================================
// CHANGELOG MANAGEMENT
// ============================================

// List all changelogs (optionally filter by slug)
router.get('/changelogs', requireAdmin, async (req, res) => {
    try {
        const slug = req.query.slug;
        let entries;
        if (slug) {
            entries = await query('SELECT * FROM changelogs WHERE slug = $1 ORDER BY published_at DESC, created_at DESC', [slug]);
        } else {
            entries = await query('SELECT * FROM changelogs ORDER BY slug, published_at DESC, created_at DESC');
        }
        res.json(entries);
    } catch (err) {
        console.error('Error fetching changelogs:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create a changelog entry
router.post('/changelogs', requireAdmin, async (req, res) => {
    const { slug, title, body, tags, published_at, is_public } = req.body;
    if (!slug || !title || !body) {
        return res.status(400).json({ error: 'slug, title, and body are required' });
    }
    try {
        await execute(
            'INSERT INTO changelogs (slug, title, body, tags, is_public, published_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [slug, title, body, tags || '', is_public !== false ? 1 : 0, published_at || new Date().toISOString()]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error creating changelog:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update a changelog entry
router.put('/changelogs/:id', requireAdmin, async (req, res) => {
    const { title, body, tags, published_at, is_public } = req.body;
    try {
        await execute(
            'UPDATE changelogs SET title = $1, body = $2, tags = $3, is_public = $4, published_at = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6',
            [title, body, tags || '', is_public !== false ? 1 : 0, published_at, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating changelog:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete a changelog entry
router.delete('/changelogs/:id', requireAdmin, async (req, res) => {
    try {
        await execute('DELETE FROM changelogs WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting changelog:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

module.exports = router;

