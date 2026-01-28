require('dotenv').config();
const crypto = require('crypto');
const emailService = require('../services/emailService');

// Database setup
let pool = null;
let db = null;
let isPostgres = false;

const dbUrl = process.argv[2] || process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith('postgresql://')) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });
    isPostgres = true;
    console.log('✓ Using PostgreSQL database');
} else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./database.db');
    console.log('✓ Using SQLite database');
}

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

async function resetAndSendMagicLink() {
    try {
        const email = 'yadavmehul24@gmail.com';
        
        console.log('🔍 Finding user:', email);
        const user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
        
        if (!user) {
            console.error('❌ User not found:', email);
            process.exit(1);
        }
        
        console.log('✓ Found user:', user.backer_name || email);
        console.log('  ID:', user.id);
        console.log('  Current pledged_status:', user.pledged_status || 'null');
        
        // Clear user data (but keep dropped backer status)
        console.log('\n🧹 Clearing user data...');
        await execute(
            `UPDATE users SET 
                pin_hash = NULL,
                otp_code = NULL,
                otp_expires_at = NULL,
                magic_link_token = NULL,
                magic_link_expires_at = NULL,
                last_login_at = NULL
             WHERE email = ?`,
            [email]
        );
        console.log('✓ Cleared PIN, OTP, magic link tokens, and last login');
        
        // Generate new magic link token
        const token = crypto.randomUUID();
        const appUrl = 'https://store.entermaya.com';
        const link = `${appUrl}/auth/magic?token=${token}`;
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        
        console.log('\n🔐 Generating magic link token...');
        console.log('  Link:', link);
        console.log('  Expires:', expiresAt);
        
        // Save token to database
        await execute(
            'UPDATE users SET magic_link_token = ?, magic_link_expires_at = ? WHERE email = ?',
            [token, expiresAt, email]
        );
        console.log('✓ Token saved to database');
        
        // Send magic link email
        console.log('\n📧 Sending magic link email...');
        const emailResult = await emailService.sendMagicLink(email, link);
        
        if (emailResult.success) {
            console.log('\n✅ Magic link sent successfully!');
            console.log('  To:', email);
            console.log('  Resend Message ID:', emailResult.messageId);
            console.log('\n📝 User status:');
            console.log('  - Dropped backer status: PRESERVED');
            console.log('  - PIN: CLEARED');
            console.log('  - OTP: CLEARED');
            console.log('  - Magic link: SENT');
        } else {
            console.error('\n❌ Failed to send email');
            console.error('  Error:', emailResult.error);
        }
        
        // Close database connection
        if (isPostgres) {
            await pool.end();
        } else {
            db.close();
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

resetAndSendMagicLink();


