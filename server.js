require('dotenv').config();

// Diagnostics: verify critical env is present (non-secret value logging)
console.log(`Env check -> RESEND_API_KEY present: ${!!process.env.RESEND_API_KEY}`);
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const session = require('express-session');
const nodemailer = require('nodemailer');
const path = require('path');
const cron = require('node-cron');
const emailService = require('./services/emailService');
const { runBackup } = require('./scripts/backup-database');

// Database module
const { initConnection, query, queryOne, execute, isPostgres, closeConnections } = require('./config/database');
// Auth middleware
const { requireAuth, requireBacker, requireAdmin, setUserSession, setSessionFromUser } = require('./middleware/auth');
// Helper utilities
const {
    OTP_TTL_MS, MAGIC_TTL_MS, LOGIN_STALE_DAYS,
    generateOtpCode, generateOtp, generateMagicToken, generateRandomPassword,
    isLoginStale, needsOtp, updateLastLogin,
    getUserByEmail, createShadowUser, ensureUserByEmail, findOrCreateShadowUser,
    isBacker, isBackerFromSession, isBackerByUserId,
    logEmail, calculateShipping, validateCartPrices
} = require('./utils/helpers');

// Routes
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable compression for all responses
const compression = require('compression');
app.use(compression());

// Initialize database connection
initConnection();

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

// Mount routes
app.use('/admin', adminRoutes);
app.use('/api/admin', adminRoutes);

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
    if (req.session.userId && !req.query.setPin) {
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
        
        // Save all user info to session
        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.backerNumber = user.backer_number;
        req.session.backerName = user.backer_name;
        req.session.pledgeAmount = user.pledge_amount;
        req.session.rewardTitle = user.reward_title;
        
        res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================
// NEW AUTH ROUTES (Email + OTP/PIN + Magic Links)
// ============================================

// Start auth flow: decide PIN vs OTP
app.post('/api/auth/initiate', async (req, res) => {
    try {
        const { email, forceOtp } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const normalizedEmail = email.trim().toLowerCase();
        const user = await ensureUserByEmail(normalizedEmail);
        if (!user) return res.status(500).json({ error: 'Could not create user' });

        // Default: ask for PIN if it exists; only send OTP when forced or no PIN set
        const needsOtp = forceOtp || !user.pin_hash;

        if (needsOtp) {
            const code = generateOtpCode();
            const expiresAt = new Date(Date.now() + OTP_TTL_MS);
            await execute(
                `UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3`,
                [code, expiresAt.toISOString(), user.id]
            );
            await emailService.sendOTP(normalizedEmail, code);
            return res.json({ status: 'otp_sent' });
        }

        return res.json({ status: 'pin_required' });
    } catch (err) {
        console.error('Auth initiate error:', err);
        res.status(500).json({ error: 'Failed to start auth' });
    }
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

        const normalizedEmail = email.trim().toLowerCase();
        const user = await queryOne('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.otp_code || !user.otp_expires_at) {
            return res.status(400).json({ error: 'No active code. Please request a new one.' });
        }

        const expires = new Date(user.otp_expires_at).getTime();
        if (Date.now() > expires) return res.status(400).json({ error: 'Code expired. Please request a new one.' });
        if (String(otp).trim() !== String(user.otp_code).trim()) return res.status(400).json({ error: 'Invalid code' });

        // Clear OTP and set session
        await execute(
            `UPDATE users SET otp_code = NULL, otp_expires_at = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [user.id]
        );

        const freshUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
        setUserSession(req, freshUser);

        if (!freshUser.pin_hash) {
            return res.json({ success: true, requiresPin: true });
        }

        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'Failed to verify code' });
    }
});

// Login with PIN
app.post('/api/auth/login-pin', async (req, res) => {
    try {
        const { email, pin } = req.body;
        if (!email || !pin) return res.status(400).json({ error: 'Email and PIN are required' });

        const normalizedEmail = email.trim().toLowerCase();
        const user = await queryOne('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        if (!user || !user.pin_hash) return res.status(400).json({ error: 'PIN not set. Please verify with code.' });

        const match = await bcrypt.compare(pin, user.pin_hash);
        if (!match) return res.status(401).json({ error: 'Invalid PIN' });

        await execute(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);
        const freshUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
        setUserSession(req, freshUser);

        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('PIN login error:', err);
        res.status(500).json({ error: 'Failed to login' });
    }
});

// Set PIN (requires active session)
app.post('/api/auth/set-pin', requireAuth, async (req, res) => {
    try {
        const { pin } = req.body;
        if (!pin || !/^[0-9]{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }

        const hash = await bcrypt.hash(pin, 10);
        await execute(
            `UPDATE users SET pin_hash = $1, last_login_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [hash, req.session.userId]
        );

        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Set PIN error:', err);
        res.status(500).json({ error: 'Failed to set PIN' });
    }
});

// Magic link handler
app.get('/auth/magic', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).send('Missing token');

        const user = await queryOne(
            'SELECT * FROM users WHERE magic_link_token = $1 AND magic_link_expires_at IS NOT NULL',
            [token]
        );

        if (!user) return res.status(400).send('Invalid or expired link');

        const expires = new Date(user.magic_link_expires_at).getTime();
        if (Date.now() > expires) return res.status(400).send('Link expired');

        // Keep token (non-single-use), update last login and log the user in
        await execute(
            `UPDATE users 
             SET last_login_at = CURRENT_TIMESTAMP 
             WHERE id = $1`,
            [user.id]
        );

        const freshUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
        setUserSession(req, freshUser);

        if (!freshUser.pin_hash) {
            return res.redirect('/login?setPin=1');
        }
        return res.redirect('/dashboard');
    } catch (err) {
        console.error('Magic link error:', err);
        res.status(500).send('Failed to process link');
    }
});

// Dashboard - View Kickstarter order
// Dashboard - View Kickstarter order (accessible to all logged-in users)
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
            pledgedStatus: user.pledged_status || 'collected', // 'dropped' or 'collected'
            kickstarterItems: user.kickstarter_items ? JSON.parse(user.kickstarter_items) : {},
            kickstarterAddons: user.kickstarter_addons ? JSON.parse(user.kickstarter_addons) : {},
            shippingCountry: user.shipping_country,
            hasCompleted: user.has_completed,
            // Payment Over Time fields
            amountDue: user.amount_due || 0,
            amountPaid: user.amount_paid || 0,
            pledgeOverTime: user.pledge_over_time === 1
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
        // Only actual Kickstarter backers get backer pricing (not just logged-in users)
        const userId = req.session?.userId || null;
        const userIsBacker = userId ? await isBackerByUserId(userId) : false;
        
        // Apply backer pricing only if user is a Kickstarter backer
        const processedAddons = addons.map(addon => {
            if (userIsBacker && addon.backer_price !== null && addon.backer_price !== undefined) {
                return {
                    ...addon,
                    original_price: addon.price,
                    price: addon.backer_price,
                    is_backer_price: true
                };
            }
            return {
                ...addon,
                is_backer_price: false
            };
        });
        
        res.json(processedAddons);
    } catch (err) {
        console.error('Error fetching addons:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all products (pledges + add-ons)
app.get('/api/products', async (req, res) => {
    console.log('\n=== API: Get Products ===');
    // Only actual Kickstarter backers get backer pricing (not just logged-in users)
    const userId = req.session?.userId || null;
    const userIsBacker = userId ? await isBackerByUserId(userId) : false;
    console.log(`User status: ${userIsBacker ? 'Kickstarter backer (backer prices)' : 'Guest/non-backer (retail prices)'}`);
    
    try {
        let pledges = [];
        let addons = [];
        
        // Get pledges from products table (Mehul's structure: pledges in products table)
        try {
            pledges = await query('SELECT * FROM products WHERE type = $1 AND active = 1', ['pledge']);
            console.log(`✓ Found ${pledges.length} pledge(s) in products table`);
            if (pledges.length > 0) {
                console.log('  Pledges:', pledges.map(p => p.name).join(', '));
            }
        } catch (pledgeErr) {
            console.log('⚠ Products table not available or error:', pledgeErr.message);
            // Products table doesn't exist - no pledges available
            pledges = [];
        }
        
        // Get add-ons from addons table (Mehul's structure: add-ons only in addons table)
        try {
            addons = await query('SELECT * FROM addons WHERE active = 1');
            console.log(`✓ Found ${addons.length} add-on(s) in addons table`);
        } catch (addonErr) {
            console.error('✗ Error fetching addons:', addonErr.message);
            addons = [];
        }
        
        // Apply backer pricing only if user is a Kickstarter backer
        // Also prefix IDs to avoid collisions between products and addons tables
        const processPledge = (item) => {
            const processed = {
                ...item,
                id: `pledge-${item.id}`,  // Prefix to avoid ID collision with addons
                db_id: item.id,            // Keep original ID for database lookups
                source: 'products',
                is_backer_price: false
            };
            if (userIsBacker && item.backer_price !== null && item.backer_price !== undefined) {
                processed.original_price = item.price;
                processed.price = item.backer_price;
                processed.is_backer_price = true;
            }
            return processed;
        };
        
        const processAddon = (item) => {
            const processed = {
                ...item,
                id: `addon-${item.id}`,   // Prefix to avoid ID collision with pledges
                db_id: item.id,            // Keep original ID for database lookups
                source: 'addons',
                is_backer_price: false
            };
            if (userIsBacker && item.backer_price !== null && item.backer_price !== undefined) {
                processed.original_price = item.price;
                processed.price = item.backer_price;
                processed.is_backer_price = true;
            }
            return processed;
        };

        const processedPledges = pledges.map(processPledge);
        const processedAddons = addons.map(processAddon);
        
        // Combine both
        const allProducts = [...processedPledges, ...processedAddons];
        console.log(`✓ Returning ${allProducts.length} total products (${pledges.length} pledges, ${addons.length} add-ons)`);
        res.json(allProducts);
    } catch (err) {
        console.error('✗ Error fetching products:', err.message);
        console.error('  Stack:', err.stack);
        res.status(500).json({ error: 'Database error', details: err.message });
    }
});

// Get Stripe publishable key
app.get('/api/stripe-key', (req, res) => {
    res.json({ 
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE' 
    });
});

// Shipping page (accessible to both backers and guests)
app.get('/shipping', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'shipping.html'));
});

// Calculate shipping (accessible to both backers and guests)
app.post('/api/calculate-shipping', (req, res) => {
    const { country, cart } = req.body;

    // If cart is empty but user is a backer, include their pledge so shipping is not zero
    let cartItems = Array.isArray(cart) ? [...cart] : [];
    if (cartItems.length === 0 && req.session?.rewardTitle) {
        cartItems.push({
            name: req.session.rewardTitle,
            quantity: 1
        });
    }

    const shippingCost = calculateShipping(country, cartItems);
    res.json({ shippingCost });
});

// Get user session info (accessible to everyone)
app.get('/api/user/session', (req, res) => {
    if (req.session && req.session.userId) {
        // Check if user is an actual Kickstarter backer
        const isBacker = !!(req.session.backerNumber || req.session.pledgeAmount || req.session.rewardTitle);
        res.json({
            isLoggedIn: true,
            isBacker: isBacker,
            user: {
                id: req.session.userId,
                email: req.session.userEmail,
                backer_number: req.session.backerNumber,
                backer_name: req.session.backerName,
                pledge_amount: req.session.pledgeAmount,
                reward_title: req.session.rewardTitle
            }
        });
    } else {
        res.json({
            isLoggedIn: false,
            isBacker: false,
            user: null
        });
    }
});

// =============================
// Additional Auth Routes
// =============================
// Note: Main /api/auth/initiate and /api/auth/verify-otp are defined earlier (lines ~135-225)
// Duplicate routes were removed to prevent conflicts

// Login with PIN
app.post('/api/auth/login-pin', async (req, res) => {
    try {
        const { email, pin } = req.body;
        if (!email || !pin) return res.status(400).json({ error: 'Email and PIN are required' });
        if (!/^[0-9]{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });

        const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        // If stale, require OTP
        if (needsOtp(user)) {
            const otp = generateOtp();
            const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
            await execute('UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3', [otp, expires, user.id]);
            try {
                await emailService.sendOTP(email, otp);
            } catch (err) {
                console.error('OTP send error:', err.message);
            }
            return res.json({ status: 'otp_sent', reason: 'stale_login' });
        }

        if (!user.pin_hash) {
            return res.status(400).json({ error: 'No PIN set for this account. Please use OTP to set a PIN.' });
        }

        const valid = await bcrypt.compare(pin, user.pin_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid PIN' });

        setSessionFromUser(req, user);
        await updateLastLogin(user.id);
        req.session.requirePinSetup = false;
        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Login PIN error:', err);
        res.status(500).json({ error: 'PIN login failed' });
    }
});

// Set PIN (after OTP or Magic Link)
app.post('/api/auth/set-pin', async (req, res) => {
    try {
        const { pin } = req.body;
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        if (!pin || !/^[0-9]{4}$/.test(pin)) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }

        const hash = await bcrypt.hash(pin, 10);
        await execute('UPDATE users SET pin_hash = $1 WHERE id = $2', [hash, req.session.userId]);
        await updateLastLogin(req.session.userId);
        req.session.requirePinSetup = false;

        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Set PIN error:', err);
        res.status(500).json({ error: 'Failed to set PIN' });
    }
});

// Magic link handler
app.get('/auth/magic', async (req, res) => {
    try {
        const token = req.query.token;
        if (!token) return res.status(400).send('Missing token');

        const user = await queryOne(
            'SELECT * FROM users WHERE magic_link_token = $1 AND magic_link_expires_at IS NOT NULL',
            [token]
        );

        if (!user) {
            return res.status(400).send('Invalid or expired link');
        }

        const expires = new Date(user.magic_link_expires_at).getTime();
        if (Date.now() > expires) {
            return res.status(400).send('Link expired');
        }

        // Keep magic link (not single-use), update last login and log in
        await updateLastLogin(user.id);
        setSessionFromUser(req, user);

        if (!user.pin_hash) {
            req.session.requirePinSetup = true;
            return res.redirect('/login?setPin=1');
        } else {
            return res.redirect('/dashboard');
        }
    } catch (err) {
        console.error('Magic link error:', err);
        res.status(500).send('Server error');
    }
});

// Get user's pledge info
app.get('/api/user/pledge-info', (req, res) => {
    if (req.session && req.session.userId) {
        res.json({
            pledgeAmount: req.session.pledgeAmount || 0,
            rewardTitle: req.session.rewardTitle || ''
        });
    } else {
        res.json({
            pledgeAmount: 0,
            rewardTitle: ''
        });
    }
});

// Save shipping address (accessible to both backers and guests)
app.post('/api/shipping/save', (req, res) => {
    const shippingAddress = req.body;
    
    // Store shipping address in session
    req.session.shippingAddress = shippingAddress;
    
    res.json({ 
        success: true, 
        message: 'Shipping address saved successfully' 
    });
});

// Checkout page (accessible to both backers and guests)
app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'checkout.html'));
});

// Create payment intent (accessible to both backers and guests)
app.post('/api/create-payment-intent', async (req, res) => {
    const { amount, cartItems, shippingAddress, shippingCost } = req.body;
    
    console.log('\n=== Payment Intent Creation Request ===');
    console.log('Amount: $' + amount);
    console.log('Cart Items:', cartItems?.length || 0);
    console.log('Shipping Address Email:', shippingAddress?.email || 'N/A');
    console.log('Shipping Cost: $' + (shippingCost || 0));
    console.log('Stripe configured:', !!stripe);
    console.log('Stripe secret key exists:', !!process.env.STRIPE_SECRET_KEY);
    
    try {
        // Check if Stripe is configured
        if (!stripe || !process.env.STRIPE_SECRET_KEY) {
            console.error('Stripe not configured!');
            return res.status(500).json({ error: 'Payment system not configured', details: 'Stripe API key missing' });
        }
        
        // Validate inputs
        if (!amount || !cartItems || !shippingAddress) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Check if user is a paid Kickstarter backer (they can checkout with just shipping)
        const isAuthenticated = req.session && req.session.userId;
        const isPaidKickstarterBacker = isAuthenticated && 
            req.session.rewardTitle && 
            req.session.pledgeAmount > 0;
        
        console.log('Session check for paid backer:');
        console.log('  - isAuthenticated:', isAuthenticated);
        console.log('  - rewardTitle:', req.session?.rewardTitle);
        console.log('  - pledgeAmount:', req.session?.pledgeAmount);
        console.log('  - isPaidKickstarterBacker:', isPaidKickstarterBacker);
        
        // Validate cart has a pledge - add-ons cannot be purchased alone
        // Exception: Paid Kickstarter backers can checkout with empty cart (just paying for shipping)
        const pledgeNames = ['humble vaanar', 'industrious manushya', 'resplendent garuda', 'benevolent divya', 'founders of neh'];
        const pledgeItems = cartItems.filter(item => {
            const nameLower = (item.name || '').toLowerCase();
            return item.type === 'pledge' || 
                   item.isPledgeUpgrade || 
                   item.isOriginalPledge || 
                   item.isDroppedBackerPledge ||
                   pledgeNames.some(pledge => nameLower.includes(pledge));
        });
        
        if (pledgeItems.length === 0 && !isPaidKickstarterBacker) {
            console.error('❌ Order rejected: No pledge in cart');
            return res.status(400).json({ 
                error: 'Pledge required', 
                details: 'You must have a pledge tier in your cart to checkout. Add-ons cannot be purchased alone.' 
            });
        }
        
        // For paid backers with empty cart, add their pledge info for the order record
        if (pledgeItems.length === 0 && isPaidKickstarterBacker) {
            console.log('✓ Paid Kickstarter backer checking out for shipping only');
            // Add their pledge to cartItems for order record (price: 0 since already paid)
            cartItems.push({
                name: req.session.rewardTitle,
                price: 0,
                quantity: 1,
                isPaidKickstarterPledge: true
            });
        }
        
        // Validate only one pledge in cart
        if (pledgeItems.length > 1) {
            console.error('❌ Order rejected: Multiple pledges in cart');
            return res.status(400).json({ 
                error: 'Multiple pledges not allowed', 
                details: 'You can only have one pledge in your cart. Please remove additional pledges before checkout.' 
            });
        }
        
        // Get user ID (isAuthenticated already determined above)
        let userId = isAuthenticated ? req.session.userId : null;
        const userEmail = shippingAddress.email || (isAuthenticated ? req.session.userEmail : null);

        // Shadow user creation for guests to link orders
        if (!userId && userEmail) {
            const shadowUser = await ensureUserByEmail(userEmail, shippingAddress.fullName || shippingAddress.name);
            userId = shadowUser ? shadowUser.id : null;
        }
        
        // Check if user is a dropped backer (payment failed on Kickstarter)
        let isDroppedBacker = false;
        if (userId) {
            try {
                const user = await queryOne('SELECT pledged_status FROM users WHERE id = $1', [userId]);
                if (user && user.pledged_status === 'dropped') {
                    isDroppedBacker = true;
                    console.log('✓ User identified as dropped backer - will charge immediately');
                }
            } catch (err) {
                console.warn('Could not check dropped backer status:', err.message);
            }
        }
        
        // SERVER-SIDE PRICE VALIDATION (Security Critical!)
        // Only Kickstarter backers get backer pricing (not just logged-in users)
        const userIsBacker = userId ? await isBackerByUserId(userId) : false;
        console.log('Validating cart prices server-side...');
        const { serverTotal, validatedItems } = await validateCartPrices(cartItems, userIsBacker);
        const expectedTotal = serverTotal + parseFloat(shippingCost || 0);
        const submittedTotal = parseFloat(amount);
        
        // Allow small rounding differences (within 1 cent)
        if (Math.abs(expectedTotal - submittedTotal) > 0.01) {
            console.error('❌ Price mismatch detected!');
            console.error(`  Expected: $${expectedTotal.toFixed(2)}`);
            console.error(`  Submitted: $${submittedTotal.toFixed(2)}`);
            console.error(`  Difference: $${Math.abs(expectedTotal - submittedTotal).toFixed(2)}`);
            return res.status(400).json({ 
                error: 'Price validation failed',
                details: 'Cart total does not match server calculation. Please refresh and try again.',
                expectedTotal: expectedTotal.toFixed(2),
                submittedTotal: submittedTotal.toFixed(2)
            });
        }
        
        console.log('✓ Price validation passed');
        console.log(`  Cart subtotal: $${serverTotal.toFixed(2)}`);
        console.log(`  Shipping: $${parseFloat(shippingCost || 0).toFixed(2)}`);
        console.log(`  Total: $${expectedTotal.toFixed(2)}`);
        console.log(`  Pricing: ${userIsBacker ? 'Kickstarter backer prices' : 'Retail prices'}`);
        
        // Check if shipping to India (for determining charge method later)
        const isIndianAddress = shippingAddress.country && 
            shippingAddress.country.toLowerCase().includes('india');
        
        // Determine order type for customer metadata
        // Indian and dropped backers are charged immediately
        const customerOrderType = (isDroppedBacker || isIndianAddress) ? 'immediate-charge' : 'pre-order-autodebit';
        
        console.log('Creating Stripe customer...');
        // Create Stripe customer
        let customer;
        try {
            customer = await stripe.customers.create({
                email: userEmail,
                name: shippingAddress.fullName,
                metadata: {
                    userId: userId ? userId.toString() : 'guest',
                    orderType: customerOrderType,
                    userType: isDroppedBacker ? 'dropped-backer' : (isIndianAddress && isAuthenticated ? 'indian-backer' : (isAuthenticated ? 'backer' : 'guest')),
                    shippingCountry: shippingAddress.country || 'unknown'
                }
            });
            console.log('✓ Customer created:', customer.id);
            console.log('  - Email:', userEmail || 'N/A');
            console.log('  - Name:', shippingAddress.fullName);
            console.log('  - User ID:', userId || 'guest');
            console.log('  - Order Type:', customerOrderType);
            console.log('  - Shipping Country:', shippingAddress.country || 'N/A');
        } catch (stripeError) {
            console.error('✗ Stripe customer creation failed');
            console.error('  - Error:', stripeError.message);
            console.error('  - Error type:', stripeError.type);
            console.error('  - Error code:', stripeError.code);
            return res.status(500).json({ error: 'Failed to create customer', details: stripeError.message });
        }
        
        // Determine payment method based on user type and location
        // Dropped backers: charge immediately (like new customers)
        // Indian backers: charge immediately (RBI regulations require immediate charge)
        // Regular backers: save card, charge later
        const chargeImmediately = isDroppedBacker || isIndianAddress;
        const captureMethod = chargeImmediately ? 'automatic' : 'manual';
        const orderType = chargeImmediately ? 'immediate-charge' : 'pre-order-autodebit';
        
        if (isIndianAddress && !isDroppedBacker) {
            console.log('✓ User is from India - will charge immediately (RBI regulations)');
        }
        
        console.log(`Creating Payment Intent (${chargeImmediately ? 'immediate charge' : 'save card for later'})...`);
        // Create Payment Intent
        // Dropped backers: automatic capture (charge immediately)
        // Indian backers: automatic capture (charge immediately - RBI regulations)
        // Regular backers: manual capture (save card, charge later)
        const amountInCents = Math.round(amount * 100);
        
        // Determine user type for metadata
        let userType = 'guest';
        if (isDroppedBacker) {
            userType = 'dropped-backer';
        } else if (isIndianAddress && isAuthenticated) {
            userType = 'indian-backer';
        } else if (isAuthenticated) {
            userType = 'backer';
        }
        
        let paymentIntent;
        try {
            paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents,
                currency: 'usd',
                customer: customer.id,
                setup_future_usage: 'off_session', // Save card for future use (both cases)
                confirmation_method: 'automatic', // Allow frontend to confirm
                capture_method: captureMethod, // Automatic for dropped/Indian backers, manual for regular backers
                payment_method_types: ['card'],
                metadata: {
                    userId: userId ? userId.toString() : 'guest',
                    userEmail: userEmail || 'unknown',
                    orderAmount: amount.toString(),
                    orderType: orderType,
                    userType: userType,
                    shippingCountry: shippingAddress.country || 'unknown'
                }
            });
            console.log('✓ Payment Intent created:', paymentIntent.id);
            console.log('  - Amount:', amountInCents, 'cents ($' + amount + ')');
            console.log('  - Customer:', customer.id);
            console.log('  - Status:', paymentIntent.status);
            console.log('  - Capture Method:', captureMethod);
            console.log('  - Order Type:', orderType);
        } catch (stripeError) {
            console.error('✗ Payment Intent creation failed:', stripeError.message);
            console.error('  - Error type:', stripeError.type);
            console.error('  - Error code:', stripeError.code);
            return res.status(500).json({ error: 'Failed to create payment intent', details: stripeError.message });
        }
        
        console.log('Saving order to database...');
        // Create order in database
        // Dropped backers: mark as succeeded and paid immediately
        // Regular backers: mark as pending (will be charged later)
        const addonsSubtotal = amount - shippingCost;
        const paymentStatus = chargeImmediately ? 'succeeded' : 'pending';
        const paidStatus = chargeImmediately ? 1 : 0;
        
        try {
            await execute(`INSERT INTO orders (
                user_id, new_addons, shipping_address, 
                shipping_cost, addons_subtotal, total, 
                stripe_customer_id, stripe_payment_intent_id,
                payment_status, paid
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, 
            [
                userId || 0,
                JSON.stringify(cartItems),
                JSON.stringify(shippingAddress),
                shippingCost,
                addonsSubtotal,
                amount,
                customer.id,
                paymentIntent.id,
                paymentStatus,
                paidStatus
            ]);
            console.log('✓ Order saved to database');
            console.log('  - Order total: $' + amount);
            console.log('  - Payment Intent ID:', paymentIntent.id);
            console.log('  - Payment Status:', paymentStatus);
            console.log('  - Paid:', paidStatus === 1 ? 'Yes' : 'No (will charge later)');

            // Store order ID in session for summary page
            const savedOrder = await queryOne('SELECT id FROM orders WHERE stripe_payment_intent_id = $1', [paymentIntent.id]);
            if (savedOrder) {
                req.session.lastOrderId = savedOrder.id;
                req.session.save(); // Ensure session is saved
            }
        } catch (dbError) {
            console.error('✗ Database insert failed:', dbError.message);
            return res.status(500).json({ error: 'Failed to save order', details: dbError.message });
        }
        
        if (chargeImmediately) {
            console.log('✓ Payment setup complete - dropped backer will be charged immediately');
        } else {
        console.log('✓ Payment setup complete - card will be saved for autodebit');
        }
        res.json({ 
            clientSecret: paymentIntent.client_secret,
            customerId: customer.id,
            paymentIntentId: paymentIntent.id
        });
    } catch (error) {
        console.error('\n✗ Unexpected error in payment setup');
        console.error('  - Error:', error.message);
        console.error('  - Stack:', error.stack);
        res.status(500).json({ 
            error: 'Payment setup failed',
            details: error.message 
        });
    }
});

// Cancel payment authorization (release funds hold while keeping card saved)
app.post('/api/cancel-payment-authorization', async (req, res) => {
    const { paymentIntentId } = req.body;
    
    console.log('\n=== Cancelling Payment Authorization ===');
    console.log('Payment Intent ID:', paymentIntentId);
    
    try {
        // Cancel the payment intent (releases authorization hold)
        const cancelled = await stripe.paymentIntents.cancel(paymentIntentId);
        console.log('✓ Payment authorization cancelled');
        console.log('  - Status:', cancelled.status);
        console.log('  - Card still saved for future use via setup_future_usage');
        
        res.json({ success: true, status: cancelled.status });
    } catch (err) {
        console.error('✗ Error cancelling authorization:', err.message);
        // Don't fail the request - card is already saved
        res.json({ success: false, error: err.message });
    }
});

// Save payment method after payment intent succeeds
app.post('/api/save-payment-method', async (req, res) => {
    const { paymentIntentId, paymentMethodId } = req.body;
    
    console.log('=== Saving Payment Method ===');
    console.log('Payment Intent ID:', paymentIntentId);
    console.log('Payment Method ID:', paymentMethodId);
    
    try {
        // If paymentMethodId not provided, retrieve it from Payment Intent
        let finalPaymentMethodId = paymentMethodId;
        
        if (!finalPaymentMethodId && paymentIntentId) {
            console.log('Retrieving Payment Intent from Stripe...');
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            finalPaymentMethodId = paymentIntent.payment_method;
            console.log('✓ Extracted payment method from Payment Intent:', finalPaymentMethodId);
        }
        
        if (!finalPaymentMethodId) {
            console.error('✗ No payment method ID available');
            return res.status(400).json({ error: 'Payment method ID is required' });
        }
        
        // Retrieve the Payment Intent to check its status
        console.log('Retrieving Payment Intent status...');
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        console.log('✓ Payment Intent status:', paymentIntent.status);
        
        // Determine if this was an immediate charge (guest) or card save (backer)
        let paymentStatus = 'card_saved';
        let paidStatus = 0;
        
        if (paymentIntent.status === 'succeeded') {
            // Payment was captured immediately (guest/non-backer)
            paymentStatus = 'succeeded';
            paidStatus = 1;
            console.log('✓ Payment succeeded - customer charged immediately');
        } else if (paymentIntent.status === 'requires_capture') {
            // Payment authorized but not captured (backer)
            paymentStatus = 'card_saved';
            paidStatus = 0;
            console.log('✓ Card authorized - will be charged when items ship');
        }
        
        // Update order with payment method ID and status
        console.log('Updating order in database...');
        await execute(`UPDATE orders 
            SET stripe_payment_method_id = $1, payment_status = $2, paid = $3 
            WHERE stripe_payment_intent_id = $4`, 
        [
            finalPaymentMethodId,
            paymentStatus,
            paidStatus,
            paymentIntentId
        ]);
        
        console.log('✓ Payment method saved successfully');
        console.log('  - Payment Method ID:', finalPaymentMethodId);
        console.log('  - Order status:', paymentStatus);
        console.log('  - Paid:', paidStatus === 1 ? 'Yes' : 'No (charge on shipment)');
        
        // Send card saved confirmation email
        try {
            const order = await queryOne('SELECT * FROM orders WHERE stripe_payment_intent_id = $1', [paymentIntentId]);
            if (order) {
                const emailResult = await emailService.sendCardSavedConfirmation(order);
                // Log email to database
                await logEmail({
                    orderId: order.id,
                    userId: order.user_id,
                    recipientEmail: JSON.parse(order.shipping_address || '{}').email,
                    emailType: 'card_saved',
                    subject: `Order #${order.id} - Order Confirmation`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            }
        } catch (emailError) {
            console.error('⚠️  Failed to send card saved confirmation email:', emailError.message);
            // Don't fail the request if email fails
        }
        
        res.json({ 
            success: true,
            paymentMethodId: finalPaymentMethodId
        });
    } catch (err) {
        console.error('✗ Error saving payment method:', err.message);
        console.error('  - Error type:', err.type);
        res.status(500).json({ error: err.message });
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
app.get('/thankyou', (req, res) => {
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

// Guest shipping page (redirects to unified shipping page)
app.get('/guest/shipping', (req, res) => {
    res.redirect('/shipping');
});

// Guest checkout page - redirect to unified checkout
app.get('/guest/checkout', (req, res) => {
    res.redirect('/checkout');
});

// Guest calculate shipping
app.post('/api/guest/calculate-shipping', (req, res) => {
    const { country, cartItems } = req.body;
    const shippingCost = calculateShipping(country, cartItems);
    res.json({ shippingCost });
});

// Guest create payment intent (save card, charge later) with shadow user linking
app.post('/api/guest/create-payment-intent', async (req, res) => {
    const { amount, cartItems, shippingAddress, shippingCost, customerEmail } = req.body;
    
    console.log('\n=== Guest Payment Intent Creation ===');
    console.log('Amount: $' + amount);
    console.log('Customer Email:', customerEmail);
    
    try {
        // Determine email and create/find shadow user
        const emailForOrder = customerEmail || shippingAddress?.email;
        if (!emailForOrder) {
            return res.status(400).json({ error: 'Email is required for guest checkout' });
        }

        const shadowUser = await ensureUserByEmail(emailForOrder, shippingAddress?.name || shippingAddress?.fullName);
        const shadowUserId = shadowUser ? shadowUser.id : null;

        // Ensure shipping address carries the email
        const shippingWithEmail = { ...(shippingAddress || {}), email: emailForOrder };
        
        // Validate cart has a pledge - add-ons cannot be purchased alone
        const pledgeNames = ['humble vaanar', 'industrious manushya', 'resplendent garuda', 'benevolent divya', 'founders of neh'];
        const pledgeItems = cartItems.filter(item => {
            const nameLower = (item.name || '').toLowerCase();
            return item.type === 'pledge' || 
                   item.isPledgeUpgrade || 
                   item.isOriginalPledge || 
                   item.isDroppedBackerPledge ||
                   pledgeNames.some(pledge => nameLower.includes(pledge));
        });
        
        if (pledgeItems.length === 0) {
            console.error('❌ Guest order rejected: No pledge in cart');
            return res.status(400).json({ 
                error: 'Pledge required', 
                details: 'You must have a pledge tier in your cart to checkout. Add-ons cannot be purchased alone.' 
            });
        }
        
        // Validate only one pledge in cart
        if (pledgeItems.length > 1) {
            console.error('❌ Guest order rejected: Multiple pledges in cart');
            return res.status(400).json({ 
                error: 'Multiple pledges not allowed', 
                details: 'You can only have one pledge in your cart. Please remove additional pledges before checkout.' 
            });
        }
        
        // SERVER-SIDE PRICE VALIDATION (Security Critical!)
        // Guests always get retail prices (isLoggedIn = false)
        console.log('Validating guest cart prices server-side...');
        const { serverTotal, validatedItems } = await validateCartPrices(cartItems, false);
        const expectedTotal = serverTotal + parseFloat(shippingCost || 0);
        const submittedTotal = parseFloat(amount);
        
        // Allow small rounding differences (within 1 cent)
        if (Math.abs(expectedTotal - submittedTotal) > 0.01) {
            console.error('❌ Price mismatch detected!');
            console.error(`  Expected: $${expectedTotal.toFixed(2)}`);
            console.error(`  Submitted: $${submittedTotal.toFixed(2)}`);
            return res.status(400).json({ 
                error: 'Price validation failed',
                details: 'Cart total does not match server calculation. Please refresh and try again.',
                expectedTotal: expectedTotal.toFixed(2),
                submittedTotal: submittedTotal.toFixed(2)
            });
        }
        
        console.log('✓ Guest price validation passed (retail prices)');
        console.log(`  Cart subtotal: $${serverTotal.toFixed(2)}`);
        console.log(`  Shipping: $${parseFloat(shippingCost || 0).toFixed(2)}`);
        console.log(`  Total: $${expectedTotal.toFixed(2)}`);

        // Create or retrieve Stripe customer
        const customer = await stripe.customers.create({
            email: emailForOrder,
            name: shippingAddress.name || shippingAddress.fullName,
            metadata: {
                orderType: 'immediate-charge',
                userType: 'guest',
                userId: shadowUserId ? shadowUserId.toString() : 'guest'
            }
        });
        console.log('✓ Guest customer created (for immediate charge):', customer.id);
        
        // Create Payment Intent with immediate charge for non-backers
        const amountInCents = Math.round(amount * 100);
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            customer: customer.id,
            setup_future_usage: 'off_session', // Save card for potential future use
            confirmation_method: 'automatic', // Allow frontend to confirm
            capture_method: 'automatic', // Charge immediately (like normal ecommerce)
            payment_method_types: ['card'],
            metadata: {
                customerEmail: customerEmail || 'guest',
                orderType: 'immediate-charge',
                userType: 'guest',
                totalAmount: amountInCents.toString()
            }
        });
        console.log('✓ Guest Payment Intent created (immediate charge):', paymentIntent.id);
        
        // Create guest order in database
        const addonsSubtotal = amount - shippingCost;
        await execute(`INSERT INTO orders (
            user_id, new_addons, shipping_address, 
            shipping_cost, addons_subtotal, total, 
            stripe_customer_id, stripe_payment_intent_id,
            payment_status, paid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, 
        [
            shadowUserId || 0,
            JSON.stringify(cartItems),
            JSON.stringify(shippingWithEmail),
            shippingCost,
            addonsSubtotal,
            amount,
            customer.id,
            paymentIntent.id,
            'pending', // Will be updated to 'succeeded' after successful payment
            0 // Will be updated to 1 after successful payment
        ]);
        console.log('✓ Guest order saved to database (awaiting payment confirmation)');
        
        // Store order ID in session for summary page
        const savedOrder = await queryOne('SELECT id FROM orders WHERE stripe_payment_intent_id = $1', [paymentIntent.id]);
        if (savedOrder) {
            req.session.lastOrderId = savedOrder.id;
            req.session.save(); // Ensure session is saved
        }
        
        res.json({ 
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id
        });
    } catch (error) {
        console.error('✗ Error creating guest Payment Intent:', error.message);
        console.error('  - Error type:', error.type);
        res.status(500).json({ error: 'Payment setup failed', details: error.message });
    }
});

// Save payment method ID to order
app.post('/api/guest/save-payment-method', async (req, res) => {
    const { paymentMethodId, customerEmail } = req.body;
    
    try {
        // Find the most recent order for this email
        let order;
        if (isPostgres()) {
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
        
        // Send card saved confirmation email
        try {
            const fullOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id]);
            if (fullOrder) {
                const emailResult = await emailService.sendCardSavedConfirmation(fullOrder);
                // Log email to database
                await logEmail({
                    orderId: fullOrder.id,
                    userId: fullOrder.user_id,
                    recipientEmail: customerEmail,
                    emailType: 'card_saved',
                    subject: `Order #${fullOrder.id} - Order Confirmation`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            }
        } catch (emailError) {
            console.error('⚠️  Failed to send card saved confirmation email:', emailError.message);
            // Don't fail the request if email fails
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving payment method:', err);
        res.status(500).json({ error: 'Failed to save payment method', details: err.message });
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
// Guest thank you route redirects to common thank you page
app.get('/guest/thankyou', (req, res) => {
    res.redirect('/thankyou');
});

// Get order summary for thank you page
app.get('/api/order/summary', async (req, res) => {
    try {
        const orderId = req.session.lastOrderId;
        if (!orderId) {
            return res.status(404).json({ error: 'No recent order found' });
        }

        const order = await queryOne('SELECT * FROM orders WHERE id = $1', [orderId]);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Parse JSON fields
        let shippingAddress = {};
        let newAddons = [];
        try {
            shippingAddress = JSON.parse(order.shipping_address || '{}');
            newAddons = JSON.parse(order.new_addons || '[]');
        } catch (e) {
            console.error('Error parsing order JSON:', e);
        }

        // Return safe summary data
        res.json({
            id: order.id,
            total: order.total,
            shippingCost: order.shipping_cost,
            addonsSubtotal: order.addons_subtotal,
            shippingAddress,
            items: newAddons,
            status: order.payment_status,
            date: order.created_at
        });
    } catch (err) {
        console.error('Error fetching order summary:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

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
             VALUES (${isPostgres() ? '$1, $2, $3, $4, $5, $6' : '?, ?, ?, ?, ?, ?'})`,
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
                 VALUES (${isPostgres() ? '$1, $2, $3, $4, $5, $6' : '?, ?, ?, ?, ?, ?'})`,
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
    
    // Schedule hourly database backups (production only)
    if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
        cron.schedule('0 * * * *', async () => {
            console.log('\n⏰ Running scheduled hourly database backup...');
            try {
                const result = await runBackup();
                if (result.success) {
                    console.log('✓ Scheduled backup completed successfully');
                } else {
                    console.error('✗ Scheduled backup failed:', result.reason || result.error);
                }
            } catch (err) {
                console.error('✗ Scheduled backup error:', err.message);
            }
        });
        console.log('📦 Hourly database backup scheduled (runs at minute 0 of each hour)');
    } else if (process.env.NODE_ENV !== 'production') {
        console.log('📦 Database backups disabled (not in production mode)');
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await closeConnections();
    process.exit(0);
});
