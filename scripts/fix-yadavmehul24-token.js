require('dotenv').config();
const crypto = require('crypto');
const emailService = require('../services/emailService');

// Database setup
let pool = null;
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
    console.error('❌ PostgreSQL database URL required');
    process.exit(1);
}

async function queryOne(sql, params = []) {
    if (isPostgres) {
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        const result = await pool.query(pgSql, params);
        return result.rows[0] || null;
    }
}

async function execute(sql, params = []) {
    if (isPostgres) {
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        await pool.query(pgSql, params);
    }
}

async function fixToken() {
    try {
        const email = 'yadavmehul24@gmail.com';
        
        console.log('🔍 Checking user:', email);
        const user = await queryOne('SELECT id, email, magic_link_token, magic_link_expires_at FROM users WHERE email = ?', [email]);
        
        if (!user) {
            console.error('❌ User not found:', email);
            process.exit(1);
        }
        
        console.log('✓ Found user:', user.email);
        console.log('  Current token:', user.magic_link_token || 'NULL');
        console.log('  Current expires:', user.magic_link_expires_at || 'NULL');
        
        if (user.magic_link_expires_at) {
            const expires = new Date(user.magic_link_expires_at).getTime();
            const now = Date.now();
            if (now > expires) {
                console.log('  ⚠️  Token is expired');
            } else {
                console.log('  ✓ Token is still valid');
            }
        }
        
        // Generate new token
        const token = crypto.randomUUID();
        const appUrl = 'https://store.entermaya.com';
        const link = `${appUrl}/auth/magic?token=${token}`;
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        
        console.log('\n🔐 Generating new magic link token...');
        console.log('  Token:', token);
        console.log('  Link:', link);
        console.log('  Expires:', expiresAt);
        
        // Save token to database
        await execute(
            'UPDATE users SET magic_link_token = ?, magic_link_expires_at = ? WHERE email = ?',
            [token, expiresAt, email]
        );
        console.log('✓ Token saved to database');
        
        // Send email
        console.log('\n📧 Sending magic link email...');
        const emailResult = await emailService.sendMagicLink(email, link);
        
        if (emailResult.success) {
            console.log('\n✅ Magic link sent successfully!');
            console.log('  To:', email);
            console.log('  Resend Message ID:', emailResult.messageId);
            console.log('  Link:', link);
        } else {
            console.error('\n❌ Failed to send email');
            console.error('  Error:', emailResult.error);
        }
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixToken();


