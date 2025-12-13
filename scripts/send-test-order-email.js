require('dotenv').config();
const emailService = require('../services/emailService');

// Database setup - PostgreSQL or SQLite
let pool = null;
let db = null;
let isPostgres = false;

// Use production database URL from env or command line arg
const dbUrl = process.argv[2] || process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith('postgresql://')) {
    // Use PostgreSQL
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
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

async function sendTestEmail() {
    try {
        const testEmail = 'mehulya24@gmail.com';
        
        if (!dbUrl || !dbUrl.startsWith('postgresql://')) {
            console.error('❌ Database URL not provided or invalid.');
            console.error('   Please provide the PostgreSQL public URL as an argument:');
            console.error('   node scripts/send-test-order-email.js "postgresql://..."');
            console.error('   Or set DATABASE_URL environment variable.');
            process.exit(1);
        }
        
        // First, try to find the user by email to get user_id
        let userId = null;
        if (isPostgres) {
            const user = await queryOne(
                `SELECT id FROM users WHERE email = $1`,
                [testEmail]
            );
            userId = user ? user.id : null;
        } else {
            const user = await queryOne(
                `SELECT id FROM users WHERE email = ?`,
                [testEmail]
            );
            userId = user ? user.id : null;
        }
        
        // Find an order for this user - try by user_id first, then by email in shipping_address
        let order;
        if (isPostgres) {
            if (userId) {
                order = await queryOne(
                    `SELECT * FROM orders 
                     WHERE user_id = $1 
                     ORDER BY id DESC LIMIT 1`,
                    [userId]
                );
            }
            
            // If no order found by user_id, try by email in shipping_address
            if (!order) {
                order = await queryOne(
                    `SELECT * FROM orders 
                     WHERE shipping_address::text LIKE $1 
                     ORDER BY id DESC LIMIT 1`,
                    [`%${testEmail}%`]
                );
            }
        } else {
            if (userId) {
                order = await queryOne(
                    `SELECT * FROM orders 
                     WHERE user_id = ? 
                     ORDER BY id DESC LIMIT 1`,
                    [userId]
                );
            }
            
            // If no order found by user_id, try by email in shipping_address
            if (!order) {
                order = await queryOne(
                    `SELECT * FROM orders 
                     WHERE shipping_address LIKE ? 
                     ORDER BY id DESC LIMIT 1`,
                    [`%${testEmail}%`]
                );
            }
        }
        
        if (!order) {
            console.error('❌ No order found for:', testEmail);
            console.error('   Please create an order first or check the email address.');
            process.exit(1);
        }
        
        // Parse shipping address to show what we're using
        const shippingAddress = typeof order.shipping_address === 'string' 
            ? JSON.parse(order.shipping_address) 
            : order.shipping_address;
        
        console.log('Found order #' + order.id + ' for ' + testEmail);
        console.log('Shipping address:', shippingAddress.fullName || shippingAddress.name);
        console.log('  ' + (shippingAddress.addressLine1 || shippingAddress.address1 || ''));
        console.log('  ' + (shippingAddress.city || '') + ', ' + (shippingAddress.state || '') + ' ' + (shippingAddress.postalCode || shippingAddress.postal || ''));
        console.log('  ' + (shippingAddress.country || ''));
        console.log('Sending order confirmation email...');
        
        const result = await emailService.sendCardSavedConfirmation(order);
        
        if (result.success) {
            console.log('\n✅ Test email sent successfully!');
            console.log('  Email sent to:', testEmail);
            console.log('  Order ID:', order.id);
            console.log('  Message ID:', result.messageId);
        } else {
            console.error('\n❌ Failed to send test email:', result.error);
        }
        
        // Close database connection
        if (isPostgres) {
            await pool.end();
        } else {
            db.close();
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error sending test email:', error);
        process.exit(1);
    }
}

sendTestEmail();

