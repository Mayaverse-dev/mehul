require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Database setup - PostgreSQL or SQLite
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
    console.log('✓ Using PostgreSQL database');
} else {
    // Fallback to SQLite
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./database.db', (err) => {
        if (err) {
            console.error('❌ Error opening database:', err);
            process.exit(1);
        }
        console.log('✓ Using SQLite database');
    });
}

// Database query wrapper
async function queryOne(sql, params = []) {
    if (isPostgres) {
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        const result = await pool.query(pgSql, params);
        return result.rows[0] || null;
    } else {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });
    }
}

async function execute(sql, params = []) {
    if (isPostgres) {
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        await pool.query(pgSql, params);
    } else {
        return new Promise((resolve, reject) => {
            db.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

async function seedDroppedBacker() {
    try {
        const email = 'mehulya24@gmail.com';
        const rewardTitle = 'The Humble Vaanar';
        const pledgeAmount = 18; // Backer price for Humble Vaanar
        
        // Check if user already exists
        const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
        
        if (existing) {
            console.log('⚠️  User already exists. Updating...');
            
            // Update existing user
            await execute(
                `UPDATE users SET 
                    backer_number = ?,
                    backer_uid = ?,
                    backer_name = ?,
                    reward_title = ?,
                    backing_minimum = ?,
                    pledge_amount = ?,
                    kickstarter_items = ?,
                    kickstarter_addons = ?,
                    pledged_status = ?
                WHERE email = ?`,
                [
                    99999, // Test backer number
                    'test-uid-' + crypto.randomBytes(8).toString('hex'),
                    'Test Dropped Backer',
                    rewardTitle,
                    18,
                    pledgeAmount,
                    JSON.stringify({
                        ebook: 1
                    }),
                    JSON.stringify({
                        lorebook_addon: 1
                    }),
                    'dropped',
                    email
                ]
            );
            
            console.log('✓ Updated existing user');
        } else {
            // Create password hash
            const password = 'test123'; // Simple password for testing
            const passwordHash = await bcrypt.hash(password, 10);
            
            // Insert new user
            await execute(
                `INSERT INTO users (
                    email, password, backer_number, backer_uid, backer_name,
                    reward_title, backing_minimum, pledge_amount,
                    kickstarter_items, kickstarter_addons, pledged_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    email,
                    passwordHash,
                    99999, // Test backer number
                    'test-uid-' + crypto.randomBytes(8).toString('hex'),
                    'Test Dropped Backer',
                    rewardTitle,
                    18,
                    pledgeAmount,
                    JSON.stringify({
                        ebook: 1
                    }),
                    JSON.stringify({
                        lorebook_addon: 1
                    }),
                    'dropped'
                ]
            );
            
            console.log('✓ Created new dropped backer user');
        }
        
        console.log('\n✅ Dropped backer seeded successfully!');
        console.log('\nUser Details:');
        console.log('  Email:', email);
        console.log('  Password: test123');
        console.log('  Pledge: The Humble Vaanar ($18)');
        console.log('  Addon: Lorebook');
        console.log('  Status: dropped (payment failed)');
        console.log('\nYou can now login and test the payment flow.');
        
        // Close database connection
        if (isPostgres) {
            await pool.end();
        } else {
            db.close();
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding dropped backer:', error);
        process.exit(1);
    }
}

seedDroppedBacker();

