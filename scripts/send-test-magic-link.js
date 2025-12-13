require('dotenv').config();
const crypto = require('crypto');
const emailService = require('../services/emailService');
const { Pool } = require('pg');

const TARGET_EMAIL = 'yadavmehul24@gmail.com';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function sendTestMagicLink() {
    try {
        console.log('🔍 Finding user:', TARGET_EMAIL);
        
        const result = await pool.query('SELECT id, email, backer_name FROM users WHERE email = $1', [TARGET_EMAIL]);
        
        if (result.rows.length === 0) {
            console.error('❌ User not found:', TARGET_EMAIL);
            await pool.end();
            return;
        }
        
        const user = result.rows[0];
        console.log('✓ Found user:', user.backer_name || user.email);
        console.log('  ID:', user.id);
        
        // Generate magic link token
        const token = crypto.randomUUID();
        const appUrl = 'https://store.entermaya.com';
        const link = `${appUrl}/auth/magic?token=${token}`;
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        
        console.log('🔐 Generated magic link token');
        console.log('🔗 Link:', link);
        
        // Save token to database
        await pool.query(
            'UPDATE users SET magic_link_token = $1, magic_link_expires_at = $2 WHERE id = $3',
            [token, expiresAt, user.id]
        );
        console.log('✓ Token saved to database');
        
        // Send email
        console.log('📧 Sending magic link email...');
        const emailResult = await emailService.sendMagicLink(user.email, link);
        
        if (emailResult.success) {
            console.log('✅ Magic link sent successfully!');
            console.log('  To:', user.email);
            console.log('  Resend Message ID:', emailResult.messageId);
        } else {
            console.error('❌ Failed to send email');
            console.error('  Error:', emailResult.error);
        }
        
        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error);
        await pool.end();
        process.exit(1);
    }
}

sendTestMagicLink();

