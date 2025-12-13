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
const emailService = require('./services/emailService');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable compression for all responses
const compression = require('compression');
app.use(compression());

// Auth constants
const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Magic links valid for 30 days
const MAGIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_STALE_DAYS = 7; // Require OTP if last login older than this

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

        // Add new auth-related columns if they do not exist
        await addColumnIfMissing('users', 'pin_hash TEXT');
        await addColumnIfMissing('users', 'otp_code TEXT');
        await addColumnIfMissing('users', `otp_expires_at ${timestampType}`);
        await addColumnIfMissing('users', 'magic_link_token TEXT');
        await addColumnIfMissing('users', `magic_link_expires_at ${timestampType}`);
        await addColumnIfMissing('users', `last_login_at ${timestampType}`);
        await addColumnIfMissing('users', 'pledged_status TEXT');

        // Add-ons table
        await execute(`CREATE TABLE IF NOT EXISTS addons (
            id ${idType} PRIMARY KEY ${autoIncrement},
            name TEXT NOT NULL,
            kickstarter_addon_id TEXT,
            price REAL NOT NULL,
            backer_price REAL,
            weight REAL DEFAULT 0,
            image TEXT,
            active INTEGER DEFAULT 1,
            description TEXT,
            created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log('✓ Add-ons table ready');
        
        // Add backer_price column to addons if missing
        await addColumnIfMissing('addons', 'backer_price REAL');
        
        // Products table (for pledges on Railway/PostgreSQL)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS products (
                id ${idType} PRIMARY KEY ${autoIncrement},
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                price REAL NOT NULL,
                backer_price REAL,
                weight REAL DEFAULT 0,
                image TEXT,
                active INTEGER DEFAULT 1,
                description TEXT,
                created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
            )`);
            console.log('✓ Products table ready');
            
            // Add backer_price column to products if missing
            await addColumnIfMissing('products', 'backer_price REAL');
        } catch (err) {
            console.log('⚠️ Products table setup skipped:', err.message);
        }

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

        // Email logs table
        await execute(`CREATE TABLE IF NOT EXISTS email_logs (
            id ${idType} PRIMARY KEY ${autoIncrement},
            order_id INTEGER,
            user_id INTEGER,
            recipient_email TEXT NOT NULL,
            email_type TEXT NOT NULL,
            subject TEXT NOT NULL,
            status TEXT DEFAULT 'sent',
            resend_message_id TEXT,
            error_message TEXT,
            sent_at ${timestampType} DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`);
        console.log('✓ Email logs table ready');

        // Create default admin
        await createDefaultAdmin();
        
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

// Attempt to add a column; ignore if it already exists
async function addColumnIfMissing(table, columnDef) {
    try {
        await execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
        console.log(`✓ Added column to ${table}: ${columnDef}`);
    } catch (err) {
        // SQLite/Postgres will throw if column exists; ignore
        const msg = err.message || '';
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
            return;
        }
        console.warn(`⚠️  Could not add column ${columnDef} to ${table}:`, err.message);
    }
}

// Generate a 4-digit OTP code
function generateOtpCode() {
    return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Generate a magic link token
function generateMagicToken() {
    return crypto.randomUUID();
}

// Determine if a user's last login is stale and needs OTP re-verification
function isLoginStale(user) {
    if (!user || !user.last_login_at) return true;
    const last = new Date(user.last_login_at).getTime();
    return Date.now() - last > LOGIN_STALE_DAYS * 24 * 60 * 60 * 1000;
}

// Set session data for authenticated user
function setUserSession(req, user) {
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.backerNumber = user.backer_number;
    req.session.backerName = user.backer_name;
    req.session.pledgeAmount = user.pledge_amount;
    req.session.rewardTitle = user.reward_title;
}

// Ensure a user exists for the given email; create a shadow user if missing
async function ensureUserByEmail(email, name) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    let user = await queryOne('SELECT * FROM users WHERE email = $1', [normalized]);
    if (user) return user;

    const randomPassword = `shadow-${crypto.randomUUID()}`;
    const hash = await bcrypt.hash(randomPassword, 10);

    await execute(
        `INSERT INTO users (email, password, backer_name, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [normalized, hash, name || null]
    );

    user = await queryOne('SELECT * FROM users WHERE email = $1', [normalized]);
    return user;
}

// Helper function to log emails to database
async function logEmail({ orderId, userId, recipientEmail, emailType, subject, status, resendMessageId, errorMessage }) {
    try {
        await execute(`INSERT INTO email_logs (
            order_id, user_id, recipient_email, email_type, subject, 
            status, resend_message_id, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
        [
            orderId || null,
            userId || null,
            recipientEmail,
            emailType,
            subject,
            status,
            resendMessageId || null,
            errorMessage || null
        ]);
    } catch (err) {
        console.error('⚠️  Failed to log email to database:', err.message);
        // Don't fail the operation if logging fails
    }
}

// Create default admin account
async function createDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'hello@entermaya.com';
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
// Auth helper utilities
// ============================================
const PIN_LOGIN_GRACE_DAYS = 7;
const OTP_TTL_MINUTES = 15;
const MAGIC_TTL_HOURS = 24 * 30; // 30 days

function generateOtpCode() {
    return crypto.randomInt(1000, 10000).toString().padStart(4, '0');
}

function generateMagicToken() {
    return crypto.randomBytes(24).toString('hex');
}

function isLoginStale(lastLoginAt) {
    if (!lastLoginAt) return true;
    const last = new Date(lastLoginAt).getTime();
    if (Number.isNaN(last)) return true;
    const diffDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
    return diffDays > PIN_LOGIN_GRACE_DAYS;
}

async function setSessionFromUser(req, user) {
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.backerNumber = user.backer_number;
    req.session.backerName = user.backer_name;
    req.session.pledgeAmount = user.pledge_amount;
    req.session.rewardTitle = user.reward_title;
}

async function getUserByEmail(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return null;
    return await queryOne('SELECT * FROM users WHERE email = $1', [normalized]);
}

async function createShadowUser(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return null;
    const dummyPassword = await bcrypt.hash(`shadow-${crypto.randomBytes(8).toString('hex')}`, 10);
    await execute(`INSERT INTO users (email, password) VALUES ($1, $2)`, [normalized, dummyPassword]);
    return await getUserByEmail(normalized);
}

// Generate a random password placeholder for shadow accounts
function generateRandomPassword(length = 16) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

function generateOtp() {
    return String(crypto.randomInt(1000, 10000)).padStart(4, '0');
}

function setSessionFromUser(req, user) {
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.backerNumber = user.backer_number;
    req.session.backerName = user.backer_name;
    req.session.pledgeAmount = user.pledge_amount;
    req.session.rewardTitle = user.reward_title;
}

function needsOtp(user) {
    if (!user) return true;
    if (!user.pin_hash) return true;
    if (!user.last_login_at) return true;
    const last = new Date(user.last_login_at);
    const staleMs = LOGIN_STALE_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - last.getTime() > staleMs;
}

async function updateLastLogin(userId) {
    const now = new Date().toISOString();
    await execute('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, userId]);
}

// Find existing user by email or create a shadow user (no PIN yet)
async function findOrCreateShadowUser(email, name = '') {
    if (!email) throw new Error('Email is required to create shadow user');

    // Check if user exists
    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing && existing.id) return existing.id;

    // Create placeholder password
    const password = generateRandomPassword();
    const hash = await bcrypt.hash(password, 10);

    // Insert user
    if (isPostgres) {
        const created = await queryOne(
            'INSERT INTO users (email, password, backer_name) VALUES ($1, $2, $3) RETURNING id',
            [email, hash, name || null]
        );
        return created.id;
    } else {
        await execute('INSERT INTO users (email, password, backer_name) VALUES (?, ?, ?)', [email, hash, name || null]);
        const created = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
        return created?.id;
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
        const isLoggedIn = !!(req.session && req.session.userId);
        
        // Apply backer pricing if user is logged in
        const processedAddons = addons.map(addon => {
            if (isLoggedIn && addon.backer_price !== null && addon.backer_price !== undefined) {
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
    const isLoggedIn = !!(req.session && req.session.userId);
    console.log(`User login status: ${isLoggedIn ? 'Logged in (backer prices)' : 'Guest (retail prices)'}`);
    
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
        
        // Apply backer pricing if user is logged in
        const processPricing = (item) => {
            if (isLoggedIn && item.backer_price !== null && item.backer_price !== undefined) {
                return {
                    ...item,
                    original_price: item.price,
                    price: item.backer_price,
                    is_backer_price: true
                };
            }
            return {
                ...item,
                is_backer_price: false
            };
        };
        
        const processedPledges = pledges.map(processPricing);
        const processedAddons = addons.map(processPricing);
        
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
        res.json({
            isLoggedIn: true,
            user: {
                id: req.session.userId,
                email: req.session.userEmail,
                backer_number: req.session.backerNumber,
                backer_name: req.session.backerName
            }
        });
    } else {
        res.json({
            isLoggedIn: false,
            user: null
        });
    }
});

// =============================
// New Auth (PIN / OTP / Magic)
// =============================

// Initiate login (decide PIN or OTP)
app.post('/api/auth/initiate', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        // Ensure user exists
        await findOrCreateShadowUser(email);
        const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const requireOtp = !user.pin_hash || forceOtp;

        if (requireOtp) {
            const otp = generateOtp();
            const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
            await execute('UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3', [otp, expires, user.id]);

            try {
                await emailService.sendOTP(email, otp);
            } catch (err) {
                console.error('OTP send error:', err.message);
            }

            return res.json({ status: 'otp_sent' });
        }

        // PIN flow
        return res.json({ status: 'pin_required' });
    } catch (err) {
        console.error('Initiate auth error:', err);
        res.status(500).json({ error: 'Auth initiation failed' });
    }
});

// Verify OTP
app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

        const user = await queryOne('SELECT * FROM users WHERE email = $1', [email]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.otp_code || !user.otp_expires_at) {
            return res.status(400).json({ error: 'No OTP requested' });
        }

        const expires = new Date(user.otp_expires_at).getTime();
        if (Date.now() > expires) {
            return res.status(400).json({ error: 'OTP expired' });
        }

        if (String(user.otp_code) !== String(otp)) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        // Clear OTP
        await execute('UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = $1', [user.id]);

        // Set session
        setSessionFromUser(req, user);
        await updateLastLogin(user.id);

        if (user.pin_hash) {
            return res.json({ success: true, requiresPin: false, redirect: '/dashboard' });
        } else {
            req.session.requirePinSetup = true;
            return res.json({ success: true, requiresPin: true });
        }
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(500).json({ error: 'OTP verification failed' });
    }
});

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

// Helper function to validate cart prices server-side (security critical!)
async function validateCartPrices(cartItems, isLoggedIn) {
    let serverTotal = 0;
    const validatedItems = [];
    
    for (const item of cartItems) {
        // Special handling for pledge upgrades - use the difference price from cart
        if (item.isPledgeUpgrade) {
            const quantity = parseInt(item.quantity) || 1;
            const pledgeUpgradePrice = parseFloat(item.price) || 0;
            const itemTotal = pledgeUpgradePrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: pledgeUpgradePrice,
                quantity: quantity,
                subtotal: itemTotal,
                isPledgeUpgrade: true
            });
            continue; // Skip database lookup for pledge upgrades
        }
        
        // Fetch actual price from database
        let dbItem = null;
        
        // Try products table first (pledges)
        try {
            dbItem = await queryOne('SELECT * FROM products WHERE id = $1 AND active = 1', [item.id]);
        } catch (err) {
            // Products table might not exist
        }
        
        // If not found, try addons table
        if (!dbItem) {
            try {
                dbItem = await queryOne('SELECT * FROM addons WHERE id = $1 AND active = 1', [item.id]);
            } catch (err) {
                console.error('Error fetching item from database:', err);
            }
        }
        
        if (!dbItem) {
            throw new Error(`Item ${item.name} not found in database`);
        }
        
        // Determine correct price based on login status
        let correctPrice = dbItem.price;
        if (isLoggedIn && dbItem.backer_price !== null && dbItem.backer_price !== undefined) {
            correctPrice = dbItem.backer_price;
        }
        
        // Calculate item total
        const quantity = parseInt(item.quantity) || 1;
        const itemTotal = correctPrice * quantity;
        serverTotal += itemTotal;
        
        validatedItems.push({
            id: dbItem.id,
            name: dbItem.name,
            price: correctPrice,
            quantity: quantity,
            subtotal: itemTotal
        });
    }
    
    return { serverTotal, validatedItems };
}

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
        
        // Determine if user is authenticated or guest
        const isAuthenticated = req.session && req.session.userId;
        let userId = isAuthenticated ? req.session.userId : null;
        const userEmail = shippingAddress.email || (isAuthenticated ? req.session.userEmail : null);

        // Shadow user creation for guests to link orders
        if (!userId && userEmail) {
            const shadowUser = await ensureUserByEmail(userEmail, shippingAddress.fullName || shippingAddress.name);
            userId = shadowUser ? shadowUser.id : null;
        }
        
        // SERVER-SIDE PRICE VALIDATION (Security Critical!)
        console.log('Validating cart prices server-side...');
        const { serverTotal, validatedItems } = await validateCartPrices(cartItems, isAuthenticated);
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
        console.log(`  Pricing: ${isAuthenticated ? 'Backer prices' : 'Retail prices'}`);
        
        console.log('Creating Stripe customer...');
        // Create Stripe customer
        let customer;
        try {
            customer = await stripe.customers.create({
                email: userEmail,
                name: shippingAddress.fullName,
                metadata: {
                    userId: userId ? userId.toString() : 'guest',
                    orderType: 'pre-order-autodebit'
                }
            });
            console.log('✓ Customer created:', customer.id);
            console.log('  - Email:', userEmail || 'N/A');
            console.log('  - Name:', shippingAddress.fullName);
            console.log('  - User ID:', userId || 'guest');
        } catch (stripeError) {
            console.error('✗ Stripe customer creation failed');
            console.error('  - Error:', stripeError.message);
            console.error('  - Error type:', stripeError.type);
            console.error('  - Error code:', stripeError.code);
            return res.status(500).json({ error: 'Failed to create customer', details: stripeError.message });
        }
        
        console.log('Creating Payment Intent with setup_future_usage...');
        // Create Payment Intent with manual confirmation to save card for later charging
        // Amount in cents, manual confirmation means no charge now
        const amountInCents = Math.round(amount * 100);
        let paymentIntent;
        try {
            paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents,
                currency: 'usd',
                customer: customer.id,
                setup_future_usage: 'off_session', // Save card for future off-session charges
                confirmation_method: 'automatic', // Allow frontend to confirm
                capture_method: 'manual', // Authorize but don't capture (charge) immediately
                payment_method_types: ['card'],
                metadata: {
                    userId: userId ? userId.toString() : 'guest',
                    userEmail: userEmail || 'unknown',
                    orderAmount: amount.toString(),
                    orderType: 'pre-order-autodebit'
                }
            });
            console.log('✓ Payment Intent created:', paymentIntent.id);
            console.log('  - Amount:', amountInCents, 'cents ($' + amount + ')');
            console.log('  - Customer:', customer.id);
            console.log('  - Status:', paymentIntent.status);
        } catch (stripeError) {
            console.error('✗ Payment Intent creation failed:', stripeError.message);
            console.error('  - Error type:', stripeError.type);
            console.error('  - Error code:', stripeError.code);
            return res.status(500).json({ error: 'Failed to create payment intent', details: stripeError.message });
        }
        
        console.log('Saving order to database...');
        // Create order in database
        const addonsSubtotal = amount - shippingCost;
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
                'pending',
                0
            ]);
            console.log('✓ Order saved to database');
            console.log('  - Order total: $' + amount);
            console.log('  - Payment Intent ID:', paymentIntent.id);

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
        
        console.log('✓ Payment setup complete - card will be saved for autodebit');
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
                    subject: `Order #${order.id} - Card Saved for Autodebit`,
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
                    subject: `Order #${fullOrder.id} - Card Saved for Autodebit`,
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

// Admin endpoint to bulk charge all orders with saved cards
app.post('/api/admin/bulk-charge-orders', requireAdmin, async (req, res) => {
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
                    off_session: true, // Important: indicates customer is not present
                    confirm: true, // Automatically confirm and charge
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
                    // Log email to database
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
                    // Don't fail the charge if email fails
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
                    // Log email to database
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
                    // Don't fail the operation if email fails
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
            // Log email to database
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
            // Don't fail the operation if email fails
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
            
            // Send payment successful email
            try {
                const shippingAddress = typeof order.shipping_address === 'string' 
                    ? JSON.parse(order.shipping_address) 
                    : order.shipping_address;
                const emailResult = await emailService.sendPaymentSuccessful(order, paymentIntent.id);
                // Log email to database
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
                // Don't fail the charge if email fails
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
                // Log email to database
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
                // Don't fail the operation if email fails
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

// Get email logs
app.get('/api/admin/email-logs', requireAdmin, async (req, res) => {
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

function calculateShipping(country, cartItems = []) {
    const { shippingRates, resolveZone } = require('./config/shipping-rates');

    const normalize = (str = '') => str.trim().toLowerCase();
    const zone = resolveZone(country || '');
    const rates = shippingRates[zone] || shippingRates['REST OF WORLD'];

    let total = 0;

    // Identify pledge tier in cart (by name match)
    const pledgeEntry = cartItems.find(item => {
        const n = normalize(item.name || '');
        return [
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh'
        ].some(key => n.includes(key));
    });

    if (pledgeEntry) {
        const pledgeName = [
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh'
        ].find(key => normalize(pledgeEntry.name || '').includes(key));
        if (pledgeName && rates.pledges?.[pledgeName]) {
            total += rates.pledges[pledgeName];
        }
    }

    // Add-on shipping (Built Environments / Lorebook / Paperback / Hardcover)
    cartItems.forEach(item => {
        const n = normalize(item.name || '');
        const qty = item.quantity || 1;
        if (n.includes('built environments')) {
            total += (rates.addons?.['Built Environments'] || 0) * qty;
        } else if (n.includes('lorebook')) {
            total += (rates.addons?.['Lorebook'] || 0) * qty;
        } else if (n.includes('paperback')) {
            total += (rates.addons?.['Paperback'] || 0) * qty;
        } else if (n.includes('hardcover')) {
            total += (rates.addons?.['Hardcover'] || 0) * qty;
        }
    });

    return total;
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
