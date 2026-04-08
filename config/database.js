/**
 * Database Configuration & Query Wrappers
 * Supports PostgreSQL (production) and SQLite (local development)
 */

let pool = null;
let db = null;
let isPostgres = false;

// Initialize database connection
function initConnection() {
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
        // Convert PostgreSQL syntax to SQLite
        // - $1, $2, etc. -> ?
        // - SERIAL -> INTEGER
        // - TIMESTAMP (as column type, not CURRENT_TIMESTAMP) -> TEXT
        const sqliteQuery = sql
            .replace(/\$(\d+)/g, '?')
            .replace(/SERIAL/g, 'INTEGER')
            .replace(/\bTIMESTAMP\b(?!\))/g, 'TEXT'); // Only replace standalone TIMESTAMP, not CURRENT_TIMESTAMP
        return new Promise((resolve, reject) => {
            db.run(sqliteQuery, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
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

// Initialize database tables
async function initializeDatabase() {
    const bcrypt = require('bcrypt');
    
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
        
        // Add Payment Over Time columns
        await addColumnIfMissing('users', 'amount_due REAL');
        await addColumnIfMissing('users', 'amount_paid REAL');
        await addColumnIfMissing('users', 'pledge_over_time INTEGER DEFAULT 0');
        await addColumnIfMissing('users', 'is_late_pledge INTEGER DEFAULT 0');

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

        // eBook metrics tables
        try {
            if (isPostgres) {
                await execute(`CREATE SCHEMA IF NOT EXISTS ebook`);
                await execute(`CREATE TABLE IF NOT EXISTS ebook.download_events (
                    id ${idType} PRIMARY KEY ${autoIncrement},
                    user_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL DEFAULT 'download_url_issued',
                    format TEXT NOT NULL,
                    country TEXT,
                    user_agent TEXT,
                    created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
                )`);
                // Legacy cleanup: we no longer store IP hashes.
                await execute(`ALTER TABLE ebook.download_events DROP COLUMN IF EXISTS ip_hash`);
                // Backward/forward compatibility: make sure event_type exists.
                await execute(`ALTER TABLE ebook.download_events ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'download_url_issued'`);
                await execute(`CREATE INDEX IF NOT EXISTS ebook_download_events_user_created_idx
                               ON ebook.download_events (user_id, created_at)`);
                await execute(`CREATE INDEX IF NOT EXISTS ebook_download_events_type_created_idx
                               ON ebook.download_events (event_type, created_at)`);
            } else {
                await execute(`CREATE TABLE IF NOT EXISTS ebook_download_events (
                    id ${idType} PRIMARY KEY ${autoIncrement},
                    user_id INTEGER NOT NULL,
                    event_type TEXT NOT NULL DEFAULT 'download_url_issued',
                    format TEXT NOT NULL,
                    country TEXT,
                    user_agent TEXT,
                    created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
                )`);
                // Best-effort legacy cleanup; older SQLite may not support DROP COLUMN.
                try { await execute(`ALTER TABLE ebook_download_events DROP COLUMN ip_hash`); } catch (_) {}
                // Best-effort: add event_type for older SQLite DBs.
                try { await execute(`ALTER TABLE ebook_download_events ADD COLUMN event_type TEXT DEFAULT 'download_url_issued'`); } catch (_) {}
                await execute(`CREATE INDEX IF NOT EXISTS ebook_download_events_user_created_idx
                               ON ebook_download_events (user_id, created_at)`);
                await execute(`CREATE INDEX IF NOT EXISTS ebook_download_events_type_created_idx
                               ON ebook_download_events (event_type, created_at)`);
            }
            console.log('✓ eBook download events table ready');
        } catch (err) {
            console.warn('⚠️  eBook metrics table setup skipped:', err.message);
        }

        // Glossary feedback table
        try {
            if (isPostgres) {
                await execute(`CREATE SCHEMA IF NOT EXISTS glossary`);
                await execute(`CREATE TABLE IF NOT EXISTS glossary.feedback (
                    id ${idType} PRIMARY KEY ${autoIncrement},
                    content TEXT NOT NULL,
                    created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
                )`);
            } else {
                await execute(`CREATE TABLE IF NOT EXISTS glossary_feedback (
                    id ${idType} PRIMARY KEY ${autoIncrement},
                    content TEXT NOT NULL,
                    created_at ${timestampType} DEFAULT CURRENT_TIMESTAMP
                )`);
            }
            console.log('✓ Glossary feedback table ready');
        } catch (err) {
            console.warn('⚠️  Glossary feedback table setup skipped:', err.message);
        }

        // Reference lookup tables (tier items + country zones)
        await execute(`CREATE TABLE IF NOT EXISTS tier_items (
            tier_name TEXT NOT NULL,
            item_key  TEXT NOT NULL,
            item_name TEXT NOT NULL,
            PRIMARY KEY (tier_name, item_key)
        )`);

        await execute(`CREATE TABLE IF NOT EXISTS country_zones (
            country_variant TEXT PRIMARY KEY,
            zone            TEXT NOT NULL
        )`);

        await seedReferenceTables();
        console.log('✓ Reference lookup tables ready');

        // Create default admin
        await createDefaultAdmin();
        
    } catch (err) {
        console.error('Error initializing database:', err);
    }
}

// Seed tier_items and country_zones from application config
async function seedReferenceTables() {
    const { TIER_ITEMS, ITEM_NAMES } = require('./tier-items');
    const { resolveZone } = require('./shipping-rates');

    // -- tier_items: upsert every tier→item row --
    for (const [tierName, itemKeys] of Object.entries(TIER_ITEMS)) {
        for (const key of itemKeys) {
            const displayName = ITEM_NAMES[key] || key;
            if (isPostgres) {
                await execute(
                    `INSERT INTO tier_items (tier_name, item_key, item_name)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (tier_name, item_key) DO UPDATE SET item_name = $3`,
                    [tierName, key, displayName]
                );
            } else {
                await execute(
                    `INSERT OR REPLACE INTO tier_items (tier_name, item_key, item_name)
                     VALUES ($1, $2, $3)`,
                    [tierName, key, displayName]
                );
            }
        }
    }

    // -- country_zones: build full variant→zone map and upsert --
    // Collect all country variants that shipping-rates.js knows about
    const variants = new Map();

    // Direct country names
    const directMappings = [
        ['United States', 'USA'], ['US', 'USA'], ['USA', 'USA'],
        ['Canada', 'CANADA'], ['Mexico', 'MEXICO'],
        ['United Kingdom', 'UK'], ['UK', 'UK'], ['Great Britain', 'UK'], ['GB', 'UK'], ['England', 'UK'],
        ['Australia', 'AUSTRALIA'], ['Austraila', 'AUSTRALIA'],
        ['New Zealand', 'NEW ZEALAND'],
        ['China', 'CHINA / HONG KONG'], ['Hong Kong', 'CHINA / HONG KONG'], ['China/ Hong Kong', 'CHINA / HONG KONG'],
        ['India', 'INDIA'], ['IN', 'INDIA'],
        ['UAE', 'ASIA'], ['Korea', 'ASIA'], ['South Korea', 'ASIA'], ['Republic of Korea', 'ASIA']
    ];
    for (const [name, zone] of directMappings) {
        variants.set(name, zone);
    }

    // EU zones
    const euZones = {
        'EU-1': ['Austria','Belgium','Czech Republic','Denmark','France','Germany','Hungary','Ireland','Luxembourg','Netherlands','Poland','Portugal','Slovakia','Spain'],
        'EU-2': ['Bulgaria','Croatia','Estonia','Finland','Greece','Italy','Latvia','Lithuania','Romania','Slovenia','Sweden'],
        'EU-3': ['Malta','Monaco','Norway','San Marino','Switzerland','Andorra','Cyprus','Serbia','Turkey','Gibraltar']
    };
    for (const [zone, countries] of Object.entries(euZones)) {
        for (const c of countries) variants.set(c, zone);
    }

    // Asia countries
    const asiaCountries = [
        'United Arab Emirates','Afghanistan','Armenia','Azerbaijan','Bangladesh',
        'Bahrain','Brunei','Bhutan','Georgia','Indonesia','Israel','Iraq',
        'Iran','Jordan','Japan','Kyrgyzstan','Cambodia','North Korea',
        'South Korea','Kuwait','Kazakhstan','Laos','Lebanon','Sri Lanka',
        'Myanmar','Mongolia','Maldives','Malaysia','Nepal','Oman',
        'Philippines','Pakistan','Palestine','Qatar','Saudi Arabia',
        'Singapore','Syria','Thailand','Tajikistan','Timor-Leste',
        'Turkmenistan','Uzbekistan','Vietnam','Yemen'
    ];
    for (const c of asiaCountries) variants.set(c, 'ASIA');

    for (const [country, zone] of variants) {
        if (isPostgres) {
            await execute(
                `INSERT INTO country_zones (country_variant, zone)
                 VALUES ($1, $2)
                 ON CONFLICT (country_variant) DO UPDATE SET zone = $2`,
                [country, zone]
            );
        } else {
            await execute(
                `INSERT OR REPLACE INTO country_zones (country_variant, zone)
                 VALUES ($1, $2)`,
                [country, zone]
            );
        }
    }
}

// Create default admin account
async function createDefaultAdmin() {
    const bcrypt = require('bcrypt');
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

// Graceful shutdown
function closeConnections() {
    return new Promise((resolve) => {
        if (isPostgres && pool) {
            pool.end().then(() => {
                console.log('PostgreSQL connections closed.');
                resolve();
            });
        } else if (db) {
            db.close((err) => {
                if (err) console.error(err.message);
                console.log('SQLite database connection closed.');
                resolve();
            });
        } else {
            resolve();
        }
    });
}

module.exports = {
    initConnection,
    query,
    queryOne,
    execute,
    isPostgres: () => isPostgres,
    closeConnections
};

