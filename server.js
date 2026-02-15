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
const ebookService = require('./services/ebookService');
const { runBackup } = require('./scripts/backup-database');

// Database module
const { initConnection, query, queryOne, execute, isPostgres, closeConnections } = require('./config/database');
// Auth middleware
const { requireAuth, requireBacker, requireEligibleBacker, requireCustomer, requireAdmin, setUserSession, setSessionFromUser } = require('./middleware/auth');
// Helper utilities
const {
    OTP_TTL_MS, MAGIC_TTL_MS, LOGIN_STALE_DAYS,
    generateOtpCode, generateOtp, generateMagicToken, generateRandomPassword,
    isLoginStale, needsOtp, updateLastLogin,
    getUserByEmail, createShadowUser, ensureUserByEmail, findOrCreateShadowUser,
    isBacker, isBackerFromSession, isBackerByUserId, isEligibleBackerByUserId, isCustomerByUserId,
    logEmail, calculateShipping, validateCartPrices
} = require('./utils/helpers');

// Routes
const adminRoutes = require('./routes/admin');

// Google Sheets Order Logging
const GOOGLE_SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

async function logOrderToGoogleSheets(order, shippingAddress, items) {
    if (!GOOGLE_SHEETS_WEBHOOK_URL) {
        console.log('⚠️  Google Sheets logging disabled (no webhook URL configured)');
        return;
    }
    
    try {
        console.log('\n=== Logging Order to Google Sheets ===');
        console.log('Order ID:', order.id);
        
        // Format order details
        const orderDetails = items.map(item => 
            `${item.name} x${item.quantity || 1} - $${item.price}`
        ).join(', ') + ` | Total: $${order.total} | Shipping: $${order.shipping_cost}`;
        
        // Format shipping address
        const addressStr = [
            shippingAddress.fullName,
            shippingAddress.addressLine1,
            shippingAddress.addressLine2,
            `${shippingAddress.city}, ${shippingAddress.state} ${shippingAddress.postalCode}`,
            shippingAddress.country,
            `Phone: ${shippingAddress.phone || 'N/A'}`
        ].filter(Boolean).join(' | ');
        
        const payload = {
            email: shippingAddress.email || 'N/A',
            orderDetails: orderDetails,
            shippingAddress: addressStr
        };
        
        console.log('Sending to Google Sheets...');
        
        const response = await fetch(GOOGLE_SHEETS_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            console.log('✓ Order logged to Google Sheets successfully');
        } else {
            console.error('✗ Google Sheets logging failed:', response.status);
        }
    } catch (error) {
        console.error('✗ Error logging to Google Sheets:', error.message);
        // Don't throw - this is a non-critical operation
    }
}

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
    const normalizedEmail = (email || '').trim().toLowerCase();

    try {
        const user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
        
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
        const user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
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
        const user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
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

function getCountryFromRequest(req) {
    // Best-effort; set by some proxies/CDNs.
    const candidates = [
        req.headers['cf-ipcountry'],
        req.headers['x-vercel-ip-country'],
        req.headers['cloudfront-viewer-country'],
        req.headers['x-country-code']
    ].filter(Boolean);
    if (candidates.length === 0) return null;
    return String(candidates[0]).trim().toUpperCase().slice(0, 10);
}

// eBook delivery page (customers: eligible backers OR users who made a payment)
app.get('/ebook', requireAuth, requireCustomer, (req, res) => {
    // Best-effort metric: user opened the eBook page.
    // Keep format non-null for compatibility with earlier schema versions.
    ebookService.logDownloadEvent({
        userId: req.session.userId,
        eventType: 'page_view',
        format: 'page',
        country: getCountryFromRequest(req),
        userAgent: req.get('user-agent')
    }).catch(() => {});

    res.sendFile(path.join(__dirname, 'views', 'ebook.html'));
});

// Get an expiring download URL (backers only)
app.get('/api/ebook/download-url', async (req, res) => {
    try {
        const userId = req.session?.userId || null;
        if (!userId) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const eligible = await isCustomerByUserId(userId);
        if (!eligible) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        const format = String(req.query.format || '').toLowerCase();
        if (!['pdf', 'epub', 'dictionary', 'mobi'].includes(format)) {
            return res.status(400).json({ error: 'Invalid format. Use pdf, epub, or dictionary.' });
        }

        const url = await ebookService.getPresignedDownloadUrl({ format });

        // Best-effort metrics; do not block the download.
        const metricEventType = (format === 'dictionary' || format === 'mobi')
            ? 'dictionary_download_url_issued'
            : 'download_url_issued';
        ebookService.logDownloadEvent({
            userId,
            eventType: metricEventType,
            format,
            country: getCountryFromRequest(req),
            userAgent: req.get('user-agent')
        }).catch(() => {});

        return res.json({ url });
    } catch (err) {
        console.error('eBook download-url error:', err.message);
        return res.status(500).json({ error: 'Failed to generate download link' });
    }
});

// Track eBook page interactions (best-effort)
app.post('/api/ebook/track', requireAuth, requireCustomer, async (req, res) => {
    try {
        const userId = req.session?.userId || null;
        if (!userId) return res.status(401).json({ error: 'Not authenticated' });

        const eventTypeRaw = (req.body && req.body.eventType) ? String(req.body.eventType).trim() : '';
        if (!eventTypeRaw) return res.status(400).json({ error: 'Missing eventType' });
        if (!/^[a-z0-9_]{1,64}$/i.test(eventTypeRaw)) {
            return res.status(400).json({ error: 'Invalid eventType' });
        }

        let format = (req.body && req.body.format) ? String(req.body.format).trim().toLowerCase() : 'epub';
        if (!['pdf', 'epub', 'dictionary', 'mobi', 'kindle', 'page'].includes(format)) format = 'epub';

        await ebookService.logDownloadEvent({
            userId,
            eventType: eventTypeRaw,
            format,
            country: getCountryFromRequest(req),
            userAgent: req.get('user-agent')
        });

        return res.status(204).end();
    } catch (err) {
        // Best-effort: never break UX for analytics.
        console.warn('eBook track error:', err?.message || err);
        return res.status(204).end();
    }
});

// Get user data for dashboard
app.get('/api/user/data', requireAuth, async (req, res) => {
    try {
        const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.session.userId]);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Check if user is a customer (eligible backer OR has made a payment)
        const isCustomer = await isCustomerByUserId(req.session.userId);
        
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
            pledgeOverTime: user.pledge_over_time === 1,
            // Late pledge flag (backed after campaign ended - pays retail prices)
            isLatePledge: user.is_late_pledge === 1,
            // Customer status (eligible backer OR has paid order)
            isCustomer
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
    // Late pledgers (backed after campaign ended) do NOT get backer prices
    const userId = req.session?.userId || null;
    let userIsBacker = userId ? await isBackerByUserId(userId) : false;
    let isLatePledge = false;
    
    // Check if user is a late pledger (backed after campaign ended - no backer pricing)
    if (userIsBacker && userId) {
        const user = await queryOne('SELECT is_late_pledge FROM users WHERE id = $1', [userId]);
        if (user && user.is_late_pledge === 1) {
            isLatePledge = true;
            userIsBacker = false; // Late pledgers don't get backer prices
            console.log('User is LATE PLEDGER - using retail prices');
        }
    }
    
    console.log(`User status: ${userIsBacker ? 'Kickstarter backer (backer prices)' : isLatePledge ? 'Late pledger (retail prices)' : 'Guest/non-backer (retail prices)'}`);
    
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
app.get('/api/user/session', async (req, res) => {
    if (req.session && req.session.userId) {
        // Check if user is an actual Kickstarter backer
        const backerStatus = !!(req.session.backerNumber || req.session.pledgeAmount || req.session.rewardTitle);
        let pledgedStatus = null;

        if (backerStatus) {
            try {
                const row = await queryOne('SELECT pledged_status FROM users WHERE id = $1', [req.session.userId]);
                pledgedStatus = row?.pledged_status || 'collected';
            } catch (err) {
                pledgedStatus = null;
            }
        }

        // Check if user is a customer (eligible backer OR has made a payment)
        const isCustomer = await isCustomerByUserId(req.session.userId);

        res.json({
            isLoggedIn: true,
            isBacker: backerStatus,
            isCustomer,
            pledgedStatus,
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
            isCustomer: false,
            pledgedStatus: null,
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

        const normalizedEmail = (email || '').trim().toLowerCase();
        const user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
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

// Get user's completed order (for dashboard locked state)
app.get('/api/user/completed-order', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        console.log(`Checking for completed order for user ${userId}`);
        
        // Find the user's most recent order with shipping address and payment method saved
        const order = await queryOne(`
            SELECT * FROM orders 
            WHERE user_id = $1 
              AND shipping_address IS NOT NULL 
              AND shipping_address != '{}'
              AND (
                  stripe_payment_method_id IS NOT NULL 
                  OR payment_status IN ('card_saved', 'succeeded')
              )
            ORDER BY created_at DESC 
            LIMIT 1
        `, [userId]);
        
        if (!order) {
            console.log(`No completed order found for user ${userId}`);
            return res.json({ hasCompletedOrder: false });
        }
        
        console.log(`Found completed order ${order.id} for user ${userId}`);
        
        // Parse JSON fields safely
        let shippingAddress = {};
        let orderItems = [];
        try {
            shippingAddress = JSON.parse(order.shipping_address || '{}');
            orderItems = JSON.parse(order.new_addons || '[]');
        } catch (e) {
            console.error('Error parsing order JSON:', e);
        }
        
        res.json({
            hasCompletedOrder: true,
            order: {
                id: order.id,
                total: order.total,
                shippingCost: order.shipping_cost,
                addonsSubtotal: order.addons_subtotal,
                paymentStatus: order.payment_status,
                paid: order.paid === 1,
                createdAt: order.created_at,
                items: orderItems,
                shippingAddress: shippingAddress
            }
        });
    } catch (err) {
        console.error('Error checking completed order:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update shipping address for existing order
app.put('/api/order/update-shipping-address', requireAuth, async (req, res) => {
    try {
        const userId = req.session.userId;
        const { orderId, shippingAddress } = req.body;
        
        console.log(`Updating shipping address for order ${orderId}, user ${userId}`);
        
        // Validate required fields
        if (!orderId || !shippingAddress) {
            return res.status(400).json({ error: 'Order ID and shipping address are required' });
        }
        
        // Validate shipping address has required fields
        const requiredFields = ['fullName', 'addressLine1', 'city', 'country', 'postalCode'];
        for (const field of requiredFields) {
            if (!shippingAddress[field]) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }
        
        // Verify the order belongs to this user
        const order = await queryOne('SELECT * FROM orders WHERE id = $1 AND user_id = $2', [orderId, userId]);
        
        if (!order) {
            console.log(`Order ${orderId} not found for user ${userId}`);
            return res.status(404).json({ error: 'Order not found' });
        }
        
        // Update the shipping address (keep shipping cost unchanged)
        await execute(
            'UPDATE orders SET shipping_address = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [JSON.stringify(shippingAddress), orderId]
        );
        
        console.log(`✓ Shipping address updated for order ${orderId}`);
        
        res.json({ 
            success: true, 
            message: 'Shipping address updated successfully',
            shippingAddress: shippingAddress
        });
    } catch (err) {
        console.error('Error updating shipping address:', err);
        res.status(500).json({ error: 'Database error' });
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
        // Dropped backers: charge immediately (PaymentIntent with automatic capture)
        // Indian backers: charge immediately (PaymentIntent with automatic capture - RBI regulations)
        // Regular KS backers: save card only (SetupIntent - no charge, no hold)
        const chargeImmediately = isDroppedBacker || isIndianAddress;
        const useSetupIntent = isAuthenticated && !chargeImmediately; // KS backers (non-India) use SetupIntent
        const orderType = chargeImmediately ? 'immediate-charge' : 'pre-order-autodebit';
        
        if (isIndianAddress && !isDroppedBacker) {
            console.log('✓ User is from India - will charge immediately (RBI regulations)');
        }
        
        // Determine user type for metadata
        let userType = 'guest';
        if (isDroppedBacker) {
            userType = 'dropped-backer';
        } else if (isIndianAddress && isAuthenticated) {
            userType = 'indian-backer';
        } else if (isAuthenticated) {
            userType = 'backer';
        }
        
        const amountInCents = Math.round(amount * 100);
        const addonsSubtotal = amount - shippingCost;
        
        // Variables to store Stripe objects
        let setupIntent = null;
        let paymentIntent = null;
        let stripeIntentId = null;
        
        if (useSetupIntent) {
            // ========================================
            // SetupIntent Flow (KS Backers - non-India)
            // Save card without charging or placing a hold
            // ========================================
            console.log('Creating SetupIntent (save card only, no charge)...');
            try {
                setupIntent = await stripe.setupIntents.create({
                    customer: customer.id,
                    usage: 'off_session', // For charging later without customer present
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
                stripeIntentId = setupIntent.id;
                console.log('✓ SetupIntent created:', setupIntent.id);
                console.log('  - Customer:', customer.id);
                console.log('  - Status:', setupIntent.status);
                console.log('  - Order Amount: $' + amount + ' (will be charged later)');
                console.log('  - Order Type:', orderType);
                console.log('  - User Type:', userType);
            } catch (stripeError) {
                console.error('✗ SetupIntent creation failed:', stripeError.message);
                console.error('  - Error type:', stripeError.type);
                console.error('  - Error code:', stripeError.code);
                return res.status(500).json({ error: 'Failed to create setup intent', details: stripeError.message });
            }
        } else {
            // ========================================
            // PaymentIntent Flow (Indian backers, dropped backers)
            // Charge immediately
            // ========================================
            console.log('Creating PaymentIntent (immediate charge)...');
            try {
                paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents,
                    currency: 'usd',
                    customer: customer.id,
                    setup_future_usage: 'off_session', // Also save card for future use
                    confirmation_method: 'automatic',
                    capture_method: 'automatic', // Charge immediately
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
                stripeIntentId = paymentIntent.id;
                console.log('✓ PaymentIntent created:', paymentIntent.id);
                console.log('  - Amount:', amountInCents, 'cents ($' + amount + ')');
                console.log('  - Customer:', customer.id);
                console.log('  - Status:', paymentIntent.status);
                console.log('  - Capture Method: automatic (charge immediately)');
                console.log('  - Order Type:', orderType);
                console.log('  - User Type:', userType);
            } catch (stripeError) {
                console.error('✗ PaymentIntent creation failed:', stripeError.message);
                console.error('  - Error type:', stripeError.type);
                console.error('  - Error code:', stripeError.code);
                return res.status(500).json({ error: 'Failed to create payment intent', details: stripeError.message });
            }
        }
        
        console.log('Saving order to database...');
        // Create order in database
        // SetupIntent (KS backers): mark as pending (will be charged later)
        // PaymentIntent (immediate): mark as succeeded
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
                stripeIntentId, // Can be SetupIntent ID (seti_) or PaymentIntent ID (pi_)
                paymentStatus,
                paidStatus
            ]);
            console.log('✓ Order saved to database');
            console.log('  - Order total: $' + amount);
            console.log('  - Stripe Intent ID:', stripeIntentId);
            console.log('  - Intent Type:', useSetupIntent ? 'SetupIntent' : 'PaymentIntent');
            console.log('  - Payment Status:', paymentStatus);
            console.log('  - Paid:', paidStatus === 1 ? 'Yes' : 'No (will charge later)');

            // Store order ID in session for summary page
            const savedOrder = await queryOne('SELECT id FROM orders WHERE stripe_payment_intent_id = $1', [stripeIntentId]);
            if (savedOrder) {
                req.session.lastOrderId = savedOrder.id;
                req.session.save(); // Ensure session is saved
            }
        } catch (dbError) {
            console.error('✗ Database insert failed:', dbError.message);
            return res.status(500).json({ error: 'Failed to save order', details: dbError.message });
        }
        
        if (useSetupIntent) {
            console.log('✓ SetupIntent ready - card will be saved (no charge, no hold)');
            res.json({ 
                clientSecret: setupIntent.client_secret,
                customerId: customer.id,
                intentId: setupIntent.id,
                intentType: 'setup' // Frontend uses this to call confirmCardSetup
            });
        } else {
            console.log('✓ PaymentIntent ready - will charge immediately');
            res.json({ 
                clientSecret: paymentIntent.client_secret,
                customerId: customer.id,
                intentId: paymentIntent.id,
                intentType: 'payment' // Frontend uses this to call confirmCardPayment
            });
        }
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

// Save payment method after SetupIntent or PaymentIntent succeeds
app.post('/api/save-payment-method', async (req, res) => {
    const { intentId, paymentMethodId, intentType } = req.body;
    
    console.log('\n=== Saving Payment Method ===');
    console.log('Intent ID:', intentId);
    console.log('Intent Type:', intentType || 'auto-detect');
    console.log('Payment Method ID:', paymentMethodId || 'will retrieve from intent');
    
    try {
        let finalPaymentMethodId = paymentMethodId;
        let paymentStatus = 'card_saved';
        let paidStatus = 0;
        
        // Auto-detect intent type from ID prefix if not provided
        const detectedType = intentType || (intentId?.startsWith('seti_') ? 'setup' : 'payment');
        console.log('Detected Intent Type:', detectedType);
        
        if (detectedType === 'setup') {
            // ========================================
            // SetupIntent Flow (KS Backers - non-India)
            // ========================================
            console.log('Processing SetupIntent...');
            
            if (!finalPaymentMethodId && intentId) {
                console.log('Retrieving SetupIntent from Stripe...');
                const setupIntent = await stripe.setupIntents.retrieve(intentId);
                finalPaymentMethodId = setupIntent.payment_method;
                console.log('✓ SetupIntent status:', setupIntent.status);
                console.log('✓ Extracted payment method:', finalPaymentMethodId);
            }
            
            // SetupIntent succeeded = card saved, no charge yet
            paymentStatus = 'card_saved';
            paidStatus = 0;
            console.log('✓ Card saved via SetupIntent - will be charged when items ship');
            
        } else {
            // ========================================
            // PaymentIntent Flow (Indian/Dropped backers, Guests)
            // ========================================
            console.log('Processing PaymentIntent...');
            
            if (!finalPaymentMethodId && intentId) {
                console.log('Retrieving PaymentIntent from Stripe...');
                const paymentIntent = await stripe.paymentIntents.retrieve(intentId);
                finalPaymentMethodId = paymentIntent.payment_method;
                console.log('✓ PaymentIntent status:', paymentIntent.status);
                console.log('✓ Extracted payment method:', finalPaymentMethodId);
                
                // Determine status based on PaymentIntent state
                if (paymentIntent.status === 'succeeded') {
                    paymentStatus = 'succeeded';
                    paidStatus = 1;
                    console.log('✓ Payment succeeded - customer charged immediately');
                } else if (paymentIntent.status === 'requires_capture') {
                    // Legacy: should not happen with new flow, but handle gracefully
                    paymentStatus = 'card_saved';
                    paidStatus = 0;
                    console.log('✓ Card authorized (legacy flow) - will be charged when items ship');
                }
            } else {
                // If we have paymentMethodId but need to check payment status
                const paymentIntent = await stripe.paymentIntents.retrieve(intentId);
                console.log('✓ PaymentIntent status:', paymentIntent.status);
                
                if (paymentIntent.status === 'succeeded') {
                    paymentStatus = 'succeeded';
                    paidStatus = 1;
                    console.log('✓ Payment succeeded - customer charged immediately');
                }
            }
        }
        
        if (!finalPaymentMethodId) {
            console.error('✗ No payment method ID available');
            return res.status(400).json({ error: 'Payment method ID is required' });
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
            intentId
        ]);
        
        console.log('✓ Payment method saved successfully');
        console.log('  - Payment Method ID:', finalPaymentMethodId);
        console.log('  - Order status:', paymentStatus);
        console.log('  - Paid:', paidStatus === 1 ? 'Yes' : 'No (charge on shipment)');
        
        // Send confirmation email
        try {
            const order = await queryOne('SELECT * FROM orders WHERE stripe_payment_intent_id = $1', [intentId]);
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
            console.error('⚠️  Failed to send confirmation email:', emailError.message);
            // Don't fail the request if email fails
        }
        
        res.json({ 
            success: true,
            paymentMethodId: finalPaymentMethodId,
            paymentStatus: paymentStatus
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
        
        console.log('✓ Guest PaymentIntent ready - will charge immediately');
        res.json({ 
            clientSecret: paymentIntent.client_secret,
            customerId: customer.id,
            intentId: paymentIntent.id,
            intentType: 'payment' // Guests always use PaymentIntent (charge immediately)
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

        // Log to Google Sheets (only once per order using session flag)
        const loggedKey = `order_${orderId}_logged`;
        if (!req.session[loggedKey]) {
            // Mark as logged before async call to prevent duplicates on rapid refreshes
            req.session[loggedKey] = true;
            req.session.save();
            
            // Log asynchronously (don't wait for it)
            logOrderToGoogleSheets(order, shippingAddress, newAddons).catch(err => {
                console.error('Google Sheets logging error:', err.message);
            });
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
