require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('✓ Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            backer_number INTEGER,
            backer_uid TEXT,
            backer_name TEXT,
            reward_title TEXT,
            backing_minimum REAL,
            pledge_amount REAL,
            kickstarter_items TEXT,
            kickstarter_addons TEXT,
            shipping_country TEXT,
            has_completed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('Error creating users table:', err);
            else console.log('✓ Users table ready');
        });

        // Add-ons table
        db.run(`CREATE TABLE IF NOT EXISTS addons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kickstarter_addon_id TEXT,
            price REAL NOT NULL,
            weight REAL DEFAULT 0,
            image TEXT,
            active INTEGER DEFAULT 1,
            description TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('Error creating addons table:', err);
            else console.log('✓ Add-ons table ready');
        });

        // Orders table
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            new_addons TEXT,
            shipping_address TEXT,
            shipping_cost REAL DEFAULT 0,
            addons_subtotal REAL DEFAULT 0,
            total REAL DEFAULT 0,
            stripe_payment_intent_id TEXT,
            paid INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`, (err) => {
            if (err) console.error('Error creating orders table:', err);
            else console.log('✓ Orders table ready');
        });

        // Safe migration: add comped_items/admin audit columns if missing
        db.run('ALTER TABLE orders ADD COLUMN comped_items TEXT', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding comped_items column:', err.message);
            }
        });
        db.run('ALTER TABLE orders ADD COLUMN admin_notes TEXT', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding admin_notes column:', err.message);
            }
        });
        db.run('ALTER TABLE orders ADD COLUMN updated_by_admin_id INTEGER', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding updated_by_admin_id column:', err.message);
            }
        });
        db.run('ALTER TABLE orders ADD COLUMN updated_at TEXT', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding updated_at column:', err.message);
            }
        });
        
        // Add columns for card-save-charge-later functionality
        db.run('ALTER TABLE orders ADD COLUMN stripe_customer_id TEXT', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding stripe_customer_id column:', err.message);
            }
        });
        db.run('ALTER TABLE orders ADD COLUMN stripe_setup_intent_id TEXT', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding stripe_setup_intent_id column:', err.message);
            }
        });
        db.run('ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT "pending"', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding payment_status column:', err.message);
            }
        });
        db.run('ALTER TABLE orders ADD COLUMN stripe_payment_method_id TEXT', (err) => {
            if (err && !String(err.message).includes('duplicate column name')) {
                console.error('Error adding stripe_payment_method_id column:', err.message);
            }
        });

        // Admins table
        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) console.error('Error creating admins table:', err);
            else {
                console.log('✓ Admins table ready');
                createDefaultAdmin();
            }
        });
    });
}

// Create default admin account
function createDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
    
    db.get('SELECT * FROM admins WHERE email = ?', [adminEmail], (err, row) => {
        if (!row) {
            bcrypt.hash(adminPassword, 10, (err, hash) => {
                if (err) {
                    console.error('Error hashing admin password:', err);
                    return;
                }
                db.run('INSERT INTO admins (email, password, name) VALUES (?, ?, ?)', 
                    [adminEmail, hash, 'Admin'], 
                    (err) => {
                        if (err) console.error('Error creating admin:', err);
                        else console.log('✓ Default admin created:', adminEmail);
                    }
                );
            });
        }
    });
}

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'maya-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Email transporter setup
const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Auth middleware
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/');
    }
}

function requireAdmin(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

// ============================================
// PUBLIC & USER ROUTES
// ============================================

// Public store homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'store.html'));
});

// Backer login page
app.get('/backer-login', (req, res) => {
    if (req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'views', 'backer-login.html'));
    }
});

// Login handler
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        res.json({ success: true, redirect: '/dashboard' });
    });
});

// Dashboard - View Kickstarter order
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Get user data for dashboard
app.get('/api/user/data', requireAuth, (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Parse JSON fields
        const userData = {
            email: user.email,
            backerNumber: user.backer_number,
            backerName: user.backer_name,
            rewardTitle: user.reward_title,
            backingMinimum: user.backing_minimum,
            pledgeAmount: user.pledge_amount,
            kickstarterItems: user.kickstarter_items ? JSON.parse(user.kickstarter_items) : {},
            kickstarterAddons: user.kickstarter_addons ? JSON.parse(user.kickstarter_addons) : {},
            shippingCountry: user.shipping_country,
            hasCompleted: user.has_completed
        };
        
        res.json(userData);
    });
});

// Add-ons page
app.get('/addons', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'addons.html'));
});

// Get available add-ons
app.get('/api/addons', (req, res) => {
    db.all('SELECT * FROM addons WHERE active = 1', (err, addons) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(addons);
    });
});

// Get Stripe publishable key
app.get('/api/stripe-key', (req, res) => {
    res.json({ 
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE' 
    });
});

// Shipping page
app.get('/shipping', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'shipping.html'));
});

// Calculate shipping
app.post('/api/calculate-shipping', requireAuth, (req, res) => {
    const { country, cartItems } = req.body;
    
    // Load shipping calculation logic
    const shippingCost = calculateShipping(country, cartItems);
    
    res.json({ shippingCost });
});

// Checkout page
app.get('/checkout', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'checkout.html'));
});

// Create payment intent
app.post('/api/create-payment-intent', requireAuth, async (req, res) => {
    const { amount, cartItems, shippingAddress, shippingCost } = req.body;
    
    try {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amount * 100), // Convert to cents
            currency: 'usd',
            metadata: {
                userId: req.session.userId,
                userEmail: req.session.userEmail
            }
        });
        
        // Create order in database
        const addonsSubtotal = amount - shippingCost;
        db.run(`INSERT INTO orders (
            user_id, new_addons, shipping_address, 
            shipping_cost, addons_subtotal, total, 
            stripe_payment_intent_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [
            req.session.userId,
            JSON.stringify(cartItems),
            JSON.stringify(shippingAddress),
            shippingCost,
            addonsSubtotal,
            amount,
            paymentIntent.id
        ]);
        
        res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        console.error('Error creating payment intent:', error);
        res.status(500).json({ error: 'Payment setup failed' });
    }
});

// Confirm payment
app.post('/api/confirm-payment', requireAuth, (req, res) => {
    const { paymentIntentId } = req.body;
    
    db.run(`UPDATE orders SET paid = 1, completed_at = CURRENT_TIMESTAMP 
            WHERE stripe_payment_intent_id = ? AND user_id = ?`, 
            [paymentIntentId, req.session.userId], 
            (err) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Mark user as completed
        db.run('UPDATE users SET has_completed = 1 WHERE id = ?', [req.session.userId]);
        
        res.json({ success: true });
    });
});

// Thank you page
app.get('/thankyou', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'thankyou.html'));
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// ============================================
// GUEST CHECKOUT ROUTES (No Auth Required)
// ============================================

// Guest shipping page
app.get('/guest/shipping', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'guest-shipping.html'));
});

// Guest checkout page
app.get('/guest/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'guest-checkout.html'));
});

// Guest calculate shipping
app.post('/api/guest/calculate-shipping', (req, res) => {
    const { country, cartItems } = req.body;
    const shippingCost = calculateShipping(country, cartItems);
    res.json({ shippingCost });
});

// Guest create setup intent (save card, charge later)
app.post('/api/guest/create-payment-intent', async (req, res) => {
    const { amount, cartItems, shippingAddress, shippingCost, customerEmail } = req.body;
    
    try {
        // Create or retrieve Stripe customer
        const customer = await stripe.customers.create({
            email: customerEmail,
            name: shippingAddress.name,
            metadata: {
                orderType: 'pre-order'
            }
        });
        
        // Create Setup Intent to save card for later charging
        const setupIntent = await stripe.setupIntents.create({
            customer: customer.id,
            payment_method_types: ['card'],
            metadata: {
                customerEmail: customerEmail || 'guest',
                orderType: 'pre-order',
                totalAmount: Math.round(amount * 100).toString()
            }
        });
        
        // Create guest order in database
        const addonsSubtotal = amount - shippingCost;
        db.run(`INSERT INTO orders (
            user_id, new_addons, shipping_address, 
            shipping_cost, addons_subtotal, total, 
            stripe_customer_id, stripe_setup_intent_id,
            payment_status, paid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [
            0, // user_id = 0 for guests
            JSON.stringify(cartItems),
            JSON.stringify({...shippingAddress, email: customerEmail}),
            shippingCost,
            addonsSubtotal,
            amount,
            customer.id,
            setupIntent.id,
            'card_saved', // Card saved, not charged yet
            0 // Not paid yet
        ]);
        
        res.json({ clientSecret: setupIntent.client_secret });
    } catch (error) {
        console.error('Error creating setup intent:', error);
        res.status(500).json({ error: 'Payment setup failed' });
    }
});

// Save payment method ID to order
app.post('/api/guest/save-payment-method', (req, res) => {
    const { paymentMethodId, customerEmail } = req.body;
    
    db.run(`UPDATE orders 
            SET stripe_payment_method_id = ?, payment_status = 'card_saved' 
            WHERE JSON_EXTRACT(shipping_address, '$.email') = ? 
            AND stripe_payment_method_id IS NULL
            ORDER BY id DESC LIMIT 1`, 
        [paymentMethodId, customerEmail], 
        (err) => {
            if (err) {
                console.error('Error saving payment method:', err);
                return res.status(500).json({ error: 'Failed to save payment method' });
            }
            res.json({ success: true });
        }
    );
});

// Admin endpoint to bulk charge all orders with saved cards
app.post('/api/admin/bulk-charge-orders', requireAdmin, async (req, res) => {
    try {
        // Get all orders with saved cards that haven't been charged yet
        db.all(`SELECT * FROM orders 
                WHERE payment_status = 'card_saved' 
                AND paid = 0 
                AND stripe_customer_id IS NOT NULL 
                AND stripe_payment_method_id IS NOT NULL`,
            async (err, orders) => {
                if (err) {
                    console.error('Error fetching orders:', err);
                    return res.status(500).json({ error: 'Failed to fetch orders' });
                }

                if (orders.length === 0) {
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

                // Process each order
                for (const order of orders) {
                    try {
                        // Charge the saved card
                        const paymentIntent = await stripe.paymentIntents.create({
                            amount: Math.round(order.total * 100), // Convert to cents
                            currency: 'usd',
                            customer: order.stripe_customer_id,
                            payment_method: order.stripe_payment_method_id,
                            off_session: true,
                            confirm: true,
                            metadata: {
                                orderId: order.id.toString(),
                                orderType: 'bulk-charge'
                            }
                        });

                        // Update order status
                        await new Promise((resolve, reject) => {
                            db.run(`UPDATE orders 
                                    SET paid = 1, 
                                        payment_status = 'charged', 
                                        stripe_payment_intent_id = ?,
                                        updated_at = CURRENT_TIMESTAMP 
                                    WHERE id = ?`, 
                                [paymentIntent.id, order.id], 
                                (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                }
                            );
                        });

                        results.charged.push({
                            orderId: order.id,
                            email: JSON.parse(order.shipping_address).email,
                            amount: order.total,
                            paymentIntentId: paymentIntent.id
                        });

                    } catch (error) {
                        console.error(`Failed to charge order ${order.id}:`, error);
                        
                        // Mark as failed
                        db.run(`UPDATE orders 
                                SET payment_status = 'charge_failed' 
                                WHERE id = ?`, 
                            [order.id]
                        );

                        results.failed.push({
                            orderId: order.id,
                            email: JSON.parse(order.shipping_address).email,
                            amount: order.total,
                            error: error.message
                        });
                    }
                }

                // Return summary
                res.json({
                    success: true,
                    message: `Bulk charge completed: ${results.charged.length} succeeded, ${results.failed.length} failed`,
                    charged: results.charged.length,
                    failed: results.failed.length,
                    total: results.total,
                    details: results
                });
            }
        );
    } catch (error) {
        console.error('Error in bulk charge:', error);
        res.status(500).json({ error: 'Failed to process bulk charge' });
    }
});

// Admin endpoint to charge a customer's saved card
app.post('/api/admin/charge-order/:orderId', requireAdmin, async (req, res) => {
    const orderId = req.params.orderId;
    
    try {
        // Get order details
        db.get('SELECT * FROM orders WHERE id = ?', [orderId], async (err, order) => {
            if (err || !order) {
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
                    amount: Math.round(order.total * 100), // Convert to cents
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
                db.run(`UPDATE orders 
                        SET paid = 1, 
                            payment_status = 'charged', 
                            stripe_payment_intent_id = ?,
                            updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?`, 
                    [paymentIntent.id, orderId], 
                    (err) => {
                        if (err) {
                            console.error('Error updating order:', err);
                            return res.status(500).json({ error: 'Failed to update order' });
                        }
                        
                        res.json({ 
                            success: true, 
                            paymentIntentId: paymentIntent.id,
                            message: `Successfully charged $${order.total.toFixed(2)}`
                        });
                    }
                );
            } catch (stripeError) {
                console.error('Stripe charge error:', stripeError);
                
                // Update order with failed status
                db.run(`UPDATE orders 
                        SET payment_status = 'charge_failed' 
                        WHERE id = ?`, 
                    [orderId]
                );
                
                res.status(500).json({ 
                    error: 'Failed to charge card: ' + stripeError.message 
                });
            }
        });
    } catch (error) {
        console.error('Error charging order:', error);
        res.status(500).json({ error: 'Failed to process charge' });
    }
});

// Guest confirm payment
app.post('/api/guest/confirm-payment', (req, res) => {
    const { paymentIntentId } = req.body;
    
    db.run(`UPDATE orders SET paid = 1, completed_at = CURRENT_TIMESTAMP 
            WHERE stripe_payment_intent_id = ?`, 
            [paymentIntentId], 
            (err) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Guest thank you page
app.get('/guest/thankyou', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'guest-thankyou.html'));
});

// ============================================
// ADMIN ROUTES
// ============================================

// Admin login page
app.get('/admin/login', (req, res) => {
    if (req.session.adminId) {
        res.redirect('/admin/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'views', 'admin', 'login.html'));
    }
});

// Admin login handler
app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    
    db.get('SELECT * FROM admins WHERE email = ?', [email], async (err, admin) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const match = await bcrypt.compare(password, admin.password);
        if (!match) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        res.json({ success: true, redirect: '/admin/dashboard' });
    });
});

// Admin dashboard
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'dashboard.html'));
});

// Get admin statistics
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    const stats = {};
    
    db.get('SELECT COUNT(*) as total FROM users', (err, row) => {
        stats.totalBackers = row.total;
        
        db.get('SELECT COUNT(*) as total FROM orders WHERE paid = 1', (err, row) => {
            stats.completedOrders = row.total;
            
            db.get('SELECT SUM(total) as revenue FROM orders WHERE paid = 1', (err, row) => {
                stats.totalRevenue = row.revenue || 0;
                
                db.get('SELECT COUNT(*) as total FROM orders WHERE paid = 0', (err, row) => {
                    stats.pendingOrders = row.total;
                    
                    res.json(stats);
                });
            });
        });
    });
});

// Get all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all('SELECT id, email, backer_number, backer_name, reward_title, pledge_amount, has_completed FROM users ORDER BY backer_number', (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(users);
    });
});

// Get all orders
app.get('/api/admin/orders', requireAdmin, (req, res) => {
    db.all(`SELECT o.*, u.email, u.backer_number, u.backer_name 
            FROM orders o 
            JOIN users u ON o.user_id = u.id 
            ORDER BY o.created_at DESC`, (err, orders) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(orders);
    });
});

// Get single order (with parsed JSON)
app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
    db.get(`SELECT o.*, u.email, u.backer_number, u.backer_name 
            FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?`, [req.params.id], (err, order) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        try {
            order.new_addons = order.new_addons ? JSON.parse(order.new_addons) : [];
            order.shipping_address = order.shipping_address ? JSON.parse(order.shipping_address) : {};
            order.compet_items = undefined; // legacy typo guard
            order.comped_items = order.comped_items ? JSON.parse(order.comped_items) : [];
        } catch (_) {}
        res.json(order);
    });
});

// Update comped items on an order
app.put('/api/admin/orders/:id/comped-items', requireAdmin, (req, res) => {
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

    const nowIso = new Date().toISOString();
    db.run(`UPDATE orders SET comped_items = ?, admin_notes = COALESCE(admin_notes, ''), 
            updated_by_admin_id = ?, updated_at = ? WHERE id = ?`, 
        [JSON.stringify(compedItems), req.session.adminId, nowIso, orderId], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true });
    });
});

// Export users to CSV
app.get('/api/admin/export/users', requireAdmin, (req, res) => {
    db.all('SELECT * FROM users ORDER BY backer_number', (err, users) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
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
    });
});

// Export orders to CSV
app.get('/api/admin/export/orders', requireAdmin, (req, res) => {
    // First get all available add-ons to create columns
    db.all('SELECT id, name FROM addons ORDER BY name', (err, availableAddons) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        db.all(`SELECT o.*, u.email, u.backer_number, u.backer_name 
                FROM orders o 
                JOIN users u ON o.user_id = u.id 
                ORDER BY o.created_at DESC`, (err, orders) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Build CSV header with add-on columns
            let csv = 'Order ID,Backer Number,Backer Name,Email,';
            
            // Add column for each add-on
            availableAddons.forEach(addon => {
                csv += `"${addon.name}",`;
            });
            
            csv += 'Add-ons Subtotal,Shipping Cost,Total,Paid,Created,Shipping Address,Comped Items\n';
            
            // Build rows
            orders.forEach(order => {
                const addons = order.new_addons ? JSON.parse(order.new_addons) : [];
                const address = order.shipping_address ? JSON.parse(order.shipping_address) : {};
                const comped = order.comped_items ? JSON.parse(order.comped_items) : [];
                
                csv += `${order.id},`;
                csv += `${order.backer_number || ''},`;
                csv += `"${order.backer_name || ''}",`;
                csv += `"${order.email || ''}",`;
                
                // For each available add-on, output quantity (0 if not in order)
                availableAddons.forEach(availableAddon => {
                    const purchased = addons.find(a => a.id === availableAddon.id || a.name === availableAddon.name);
                    csv += `${purchased ? purchased.quantity : 0},`;
                });
                
                csv += `${order.addons_subtotal || 0},`;
                csv += `${order.shipping_cost || 0},`;
                csv += `${order.total || 0},`;
                csv += `${order.paid ? 'Yes' : 'No'},`;
                csv += `"${order.created_at || ''}",`;
                
                // Format address
                const addressStr = `${address.fullName || ''} | ${address.addressLine1 || ''} ${address.addressLine2 || ''} | ${address.city || ''}, ${address.state || ''} ${address.postalCode || ''} | ${address.country || ''} | Phone: ${address.phone || ''}`;
                csv += `"${addressStr}",`;
                
                // Format comped items
                const compedStr = comped.map(c => `${c.name} x${c.quantity}${c.note ? ' (' + c.note + ')' : ''}`).join('; ');
                csv += `"${compedStr}"\n`;
            });
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=maya-orders-export.csv');
            res.send(csv);
        });
    });
});

// Admin logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculateShipping(country, cartItems) {
    // Load shipping rates from config
    const shippingConfig = require('./config/shipping-rates');
    
    // Determine zone
    let zone = 'zone4'; // Default: rest of world
    for (const [zoneName, countries] of Object.entries(shippingConfig.shippingZones)) {
        if (countries.includes(country)) {
            zone = zoneName;
            break;
        }
    }
    
    // Calculate total weight
    let totalWeight = 0;
    cartItems.forEach(item => {
        totalWeight += (item.weight || 0) * item.quantity;
    });
    
    // Get rates for zone
    const rates = shippingConfig.shippingRates[zone];
    
    // Calculate shipping cost
    const shippingCost = rates.base + (cartItems.length * rates.perItem);
    
    return shippingCost;
}

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🚀 MAYA Pledge Manager running on http://localhost:${PORT}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Copy .env.example to .env and configure`);
    console.log(`   2. Import Kickstarter CSV: npm run import-csv path-to-csv.csv`);
    console.log(`   3. Admin login at: http://localhost:${PORT}/admin/login\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('\nDatabase connection closed.');
        process.exit(0);
    });
});

