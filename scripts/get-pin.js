require('dotenv').config();

const dbUrl = process.argv[2] || process.env.DATABASE_URL;

if (!dbUrl || !dbUrl.startsWith('postgresql://')) {
    console.error('❌ PostgreSQL database URL required');
    process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
});

async function getPin() {
    try {
        const backerNumber = 3159;
        const email = 'renjeephilip.simca@gmail.com';
        
        console.log(`🔍 Looking up PIN for backer #${backerNumber} - ${email}...\n`);
        
        // Try by backer number first
        let result = await pool.query(
            'SELECT email, pin_hash, last_login_at FROM users WHERE backer_number = $1',
            [backerNumber]
        );
        
        if (result.rows.length === 0) {
            // Try by email
            result = await pool.query(
                'SELECT email, pin_hash, last_login_at FROM users WHERE email = $1',
                [email]
            );
        }
        
        if (result.rows.length === 0) {
            console.log('❌ User not found');
            process.exit(1);
        }
        
        const user = result.rows[0];
        
        console.log('✅ Found user:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Email: ${user.email}`);
        console.log(`PIN Hash: ${user.pin_hash || 'NULL (no PIN set)'}`);
        console.log(`Last Login: ${user.last_login_at || 'Never'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        if (!user.pin_hash) {
            console.log('\n⚠️  No PIN is set for this user.');
            console.log('   They will need to use magic link or OTP to log in.');
        } else {
            console.log('\n⚠️  PIN is hashed and cannot be retrieved.');
            console.log('   You will need to reset it or use magic link/OTP.');
        }
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

getPin();


