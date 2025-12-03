require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable compression for all responses
const compression = require('compression');
app.use(compression());

// Database setup - PostgreSQL (production) or SQLite (development fallback)
let pool = null;
let db = null;
let isPostgres = false;

if (process.env.DATABASE_URL) {
    // Use PostgreSQL
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    isPostgres = true;
    
    // Test database connection
    pool.connect((err, client, release) => {
        if (err) {
            console.error('Error connecting to PostgreSQL:', err);
            process.exit(1);
        } else {
            console.log('✓ Connected to PostgreSQL database');
            release();
            initializeDatabase();
        }
    });
} else {
    // Fallback to SQLite for local development
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
            console.error('Error opening SQLite database:', err);
            process.exit(1);
        } else {
            console.log('✓ Using SQLite database (local development)');
            console.log('⚠️  For production, set DATABASE_URL in .env');
            initializeDatabase();
        }
    });
}

// Database query wrapper - works with both PostgreSQL and SQLite
async function query(sql, params = []) {
    if (isPostgres) {
        // PostgreSQL - use $1, $2, $3 placeholders
        const result = await pool.query(sql, params);
        return result.rows;
    } else {
        // SQLite - use ? placeholders and convert query
        const sqliteQuery = sql.replace(/\$(\d+)/g, '?');
        return new Promise((resolve, reject) => {
            db.all(sqliteQuery, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
}

async function queryOne(sql, params = []) {
    if (isPostgres) {
        const result = await pool.query(sql, params);
        return result.rows[0];
    } else {
        const sqliteQuery = sql.replace(/\$(\d+)/g, '?');
        return new Promise((resolve, reject) => {
            db.get(sqliteQuery, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
}

async function execute(sql, params = []) {
    if (isPostgres) {
        await pool.query(sql, params);
    } else {
        const sqliteQuery = sql.replace(/\$(\d+)/g, '?').replace(/SERIAL/g, 'INTEGER').replace(/TIMESTAMP/g, 'TEXT');
        return new Promise((resolve, reject) => {
            db.run(sqliteQuery, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }
}

// Initialize database tables
async function initializeDatabase() {
    try {
        const idType = isPostgres ? 'SERIAL' : 'INTEGER';
        const timestampType = isPostgres ? 'TIMESTAMP' : 'TEXT';
        const autoIncrement = isPostgres ? '' : 'AUTOINCREMENT';
        
        // Users table
        await execute(`CREATE TABLE IF NOT EXISTS users (
            id ${idType} PRIMARY KEY ${autoIncrement},
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
            created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✓ Users table ready');

        // Add-ons table
        await execute(`CREATE TABLE IF NOT EXISTS addons (
            id ${idType} PRIMARY KEY ${autoIncrement},
            name TEXT NOT NULL,
            kickstarter_addon_id TEXT,
            price REAL NOT NULL,
            weight REAL DEFAULT 0,
            image TEXT,
            active INTEGER DEFAULT 1,
            description TEXT,
            created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✓ Add-ons table ready');

        // Orders table
        await execute(`CREATE TABLE IF NOT EXISTS orders (
            id ${idType} PRIMARY KEY ${autoIncrement},
            user_id INTEGER NOT NULL,
            new_addons TEXT,
            shipping_address TEXT,
            shipping_cost REAL DEFAULT 0,
            addons_subtotal REAL DEFAULT 0,
            total REAL DEFAULT 0,
            stripe_payment_intent_id TEXT,
            paid INTEGER DEFAULT 0,
            created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP,
            completed_at ${timestampType},
            comped_items TEXT,
            admin_notes TEXT,
            updated_by_admin_id INTEGER,
            updated_at ${timestampType},
            stripe_customer_id TEXT,
            stripe_setup_intent_id TEXT,
            payment_status TEXT DEFAULT 'pending',
            stripe_payment_method_id TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);
        console.log('✓ Orders table ready');

        // Admins table
        await execute(`CREATE TABLE IF NOT EXISTS admins (
            id ${idType} PRIMARY KEY ${autoIncrement},
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT,
            created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
        )`);
                console.log('✓ Admins table ready');

        // Create default admin
        await createDefaultAdmin();
        
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

// Create default admin account
async function createDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
    
    try {
        const admin = await queryOne('SELECT * FROM admins WHERE email = $1', [adminEmail]);
        if (!admin) {
            const hash = await bcrypt.hash(adminPassword, 10);
            await execute('INSERT INTO admins (email, password, name) VALUES ($1, $2, $3)', 
                [adminEmail, hash, 'Admin']);
            console.log('✓ Default admin created:', adminEmail);
        }
    } catch (err) {
        console.error('Error creating admin:', err);
    }
}

// Middleware
// Serve static files with caching
app.use(express.static('public', {
    maxAge: '1d', // Cache for 1 day
    etag: true,
    lastModified: true
}));
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

// Test component page
app.get('/test-component', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'test-component.html'));
});

// Login page
app.get('/login', (req, res) => {
    if (req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'views', 'login.html'));
    }
});

// Login handler
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
        
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
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Dashboard - View Kickstarter order
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Get user data for dashboard
app.get('/api/user/data', requireAuth, async (req, res) => {
    try {
        const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.session.userId]);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
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
    } catch (err) {
        console.error('Error fetching user data:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add-ons page
// Cart/Add-ons page (works for both guests and logged-in users)
app.get('/addons', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'addons.html'));
});

// Get available add-ons
app.get('/api/addons', async (req, res) => {
    try {
        const addons = await query('SELECT * FROM addons WHERE active = 1');
        res.json(addons);
    } catch (err) {
        console.error('Error fetching addons:', err);
        res.status(500).json({ error: 'Database error' });
    }
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
        await execute(`INSERT INTO orders (
            user_id, new_addons, shipping_address, 
            shipping_cost, addons_subtotal, total, 
            stripe_payment_intent_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, 
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
app.post('/api/confirm-payment', requireAuth, async (req, res) => {
    const { paymentIntentId } = req.body;
    
    try {
        await execute(`UPDATE orders SET paid = 1, completed_at = CURRENT_TIMESTAMP 
            WHERE stripe_payment_intent_id = $1 AND user_id = $2`, 
            [paymentIntentId, req.session.userId]);
        
        // Mark user as completed
        await execute('UPDATE users SET has_completed = 1 WHERE id = $1', [req.session.userId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error confirming payment:', err);
        res.status(500).json({ error: 'Database error' });
    }
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
        await execute(`INSERT INTO orders (
            user_id, new_addons, shipping_address, 
            shipping_cost, addons_subtotal, total, 
            stripe_customer_id, stripe_setup_intent_id,
            payment_status, paid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, 
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
app.post('/api/guest/save-payment-method', async (req, res) => {
    const { paymentMethodId, customerEmail } = req.body;
    
    try {
        // Find the most recent order for this email
        let order;
        if (isPostgres) {
            order = await queryOne(`SELECT id FROM orders 
                WHERE shipping_address::json->>'email' = $1 
                AND stripe_payment_method_id IS NULL
                ORDER BY id DESC LIMIT 1`, 
                [customerEmail]);
        } else {
            order = await queryOne(`SELECT id FROM orders 
                WHERE json_extract(shipping_address, '$.email') = $1 
                AND stripe_payment_method_id IS NULL
                ORDER BY id DESC LIMIT 1`, 
                [customerEmail]);
        }
        
        if (!order) {
            console.error('No order found for email:', customerEmail);
            return res.status(404).json({ error: 'Order not found' });
        }
        
        // Update the order with payment method
        await execute(`UPDATE orders 
            SET stripe_payment_method_id = $1, payment_status = 'card_saved' 
            WHERE id = $2`, 
            [paymentMethodId, order.id]);
        
        console.log('✓ Payment method saved for order:', order.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving payment method:', err);
        res.status(500).json({ error: 'Failed to save payment method', details: err.message });
    }
});

// Admin endpoint to bulk charge all orders with saved cards
app.post('/api/admin/bulk-charge-orders', requireAdmin, async (req, res) => {
    try {
        // Get all orders with saved cards that haven't been charged yet
        const orders = await query(`SELECT * FROM orders 
            WHERE payment_status = 'card_saved' 
            AND paid = 0 
            AND stripe_customer_id IS NOT NULL 
            AND stripe_payment_method_id IS NOT NULL`);

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
                await execute(`UPDATE orders 
                    SET paid = 1, 
                        payment_status = 'charged', 
                        stripe_payment_intent_id = $1,
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE id = $2`, 
                    [paymentIntent.id, order.id]);

                results.charged.push({
                    orderId: order.id,
                    email: JSON.parse(order.shipping_address).email,
                    amount: order.total,
                    paymentIntentId: paymentIntent.id
                });

            } catch (error) {
                console.error(`Failed to charge order ${order.id}:`, error);
                
                // Mark as failed
                await execute(`UPDATE orders 
                    SET payment_status = 'charge_failed' 
                    WHERE id = $1`, 
                    [order.id]);

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
            await execute(`UPDATE orders 
                SET paid = 1, 
                    payment_status = 'charged', 
                    stripe_payment_intent_id = $1,
                    updated_at = CURRENT_TIMESTAMP 
                WHERE id = $2`, 
                [paymentIntent.id, orderId]);
            
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
            
            res.status(500).json({ 
                error: 'Failed to charge card: ' + stripeError.message 
            });
        }
    } catch (error) {
        console.error('Error charging order:', error);
        res.status(500).json({ error: 'Failed to process charge' });
    }
});

// Guest confirm payment
app.post('/api/guest/confirm-payment', async (req, res) => {
    const { paymentIntentId } = req.body;
    
    try {
        await execute(`UPDATE orders SET paid = 1, completed_at = CURRENT_TIMESTAMP 
            WHERE stripe_payment_intent_id = $1`, 
            [paymentIntentId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error confirming payment:', err);
        res.status(500).json({ error: 'Database error' });
    }
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
    
    try {
        const admin = await queryOne('SELECT * FROM admins WHERE email = $1', [email]);
        
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
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Admin dashboard
app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'dashboard.html'));
});

// Get admin statistics
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
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
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const users = await query('SELECT id, email, backer_number, backer_name, reward_title, pledge_amount, has_completed FROM users ORDER BY backer_number');
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all orders
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
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

// Get single order (with parsed JSON)
app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
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
app.put('/api/admin/orders/:id/comped-items', requireAdmin, async (req, res) => {
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
app.get('/api/admin/export/users', requireAdmin, async (req, res) => {
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
app.get('/api/admin/export/orders', requireAdmin, async (req, res) => {
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
// TEMPORARY SEED ENDPOINT (REMOVE AFTER USE)
// ============================================
app.get('/api/seed-main-book/:secret', async (req, res) => {
    if (req.params.secret !== 'maya-seed-2024') {
        return res.status(403).json({ error: 'Invalid secret' });
    }
    
    try {
        await query(
            `INSERT INTO addons (name, price, weight, description, image, active)
             VALUES (${isPostgres ? '$1, $2, $3, $4, $5, $6' : '?, ?, ?, ?, ?, ?'})`,
            ['MAYA: Seed Takes Root Hardcover', 50.00, 500, 'An epic sci-fiction fantasy with intricate worldbuilding. Six species, one planet, zero privacy. Enter the age of narrative warfare.', 'maya-book.jpeg', 1]
        );
        res.json({ success: true, message: 'Successfully added main book' });
    } catch (error) {
        console.error('Seed error:', error);
        res.status(500).json({ error: 'Failed to add main book', details: error.message });
    }
});

app.get('/api/seed-addons-temp/:secret', async (req, res) => {
    // Simple secret check
    if (req.params.secret !== 'maya-seed-2024') {
        return res.status(403).json({ error: 'Invalid secret' });
    }
    const addons = [
        {
            name: 'MAYA Bookmark',
            price: 15.00,
            weight: 20,
            description: 'Beautiful MAYA bookmarks featuring stunning artwork from the series',
            image: 'maya-bookmark.png',
            active: 1
        },
        {
            name: 'MAYA Sticker',
            price: 10.00,
            weight: 10,
            description: 'Premium vinyl stickers featuring characters from MAYA',
            image: 'maya-sticker.png',
            active: 1
        },
        {
            name: 'MAYA Poster',
            price: 25.00,
            weight: 150,
            description: 'High-quality art poster featuring the world of MAYA',
            image: 'maya-poster.png',
            active: 1
        },
        {
            name: 'MAYA Notebook',
            price: 20.00,
            weight: 300,
            description: 'Premium notebook with MAYA artwork cover',
            image: 'maya-notebook.png',
            active: 1
        },
        {
            name: 'MAYA Patches',
            price: 12.00,
            weight: 25,
            description: 'Embroidered patches featuring MAYA characters and symbols',
            image: 'maya-patches.png',
            active: 1
        },
        {
            name: 'MAYA Enamel Pin',
            price: 18.00,
            weight: 30,
            description: 'High-quality enamel pins with intricate MAYA designs',
            image: 'maya-enamel-pin.png',
            active: 1
        }
    ];

    try {
        const results = [];
        for (const addon of addons) {
            await query(
                `INSERT INTO addons (name, price, weight, description, image, active)
                 VALUES (${isPostgres ? '$1, $2, $3, $4, $5, $6' : '?, ?, ?, ?, ?, ?'})`,
                [addon.name, addon.price, addon.weight, addon.description, addon.image, addon.active]
            );
            results.push(`Added: ${addon.name} ($${addon.price})`);
        }
        res.json({ success: true, message: 'Successfully seeded add-ons', results });
    } catch (error) {
        console.error('Seed error:', error);
        res.status(500).json({ error: 'Failed to seed add-ons', details: error.message });
    }
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 MAYA Pledge Manager running on http://localhost:${PORT}`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Set DATABASE_URL in .env (or Railway will auto-provide it)`);
    console.log(`   2. Import Kickstarter CSV: npm run import-csv path-to-csv.csv`);
    console.log(`   3. Admin login at: http://localhost:${PORT}/admin/login\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    if (isPostgres && pool) {
        await pool.end();
        console.log('PostgreSQL connections closed.');
    } else if (db) {
    db.close((err) => {
            if (err) console.error(err.message);
            console.log('SQLite database connection closed.');
        });
        }
        process.exit(0);
});
