require('dotenv').config();
const bcrypt = require('bcrypt');

const dbUrl = process.argv[2] || process.env.DATABASE_URL;
const newPin = process.argv[3] || '1234'; // Default PIN for testing

if (!dbUrl || !dbUrl.startsWith('postgresql://')) {
    console.error('❌ PostgreSQL database URL required');
    process.exit(1);
}

const { Pool } = require('pg');
const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
});

async function resetPin() {
    try {
        const backerNumber = 3159;
        const email = 'renjeephilip.simca@gmail.com';
        
        console.log(`🔐 Resetting PIN for backer #${backerNumber}...\n`);
        
        // Hash the new PIN
        const pinHash = await bcrypt.hash(newPin, 10);
        
        // Update the PIN
        const result = await pool.query(
            'UPDATE users SET pin_hash = $1, last_login_at = CURRENT_TIMESTAMP WHERE backer_number = $2 RETURNING email',
            [pinHash, backerNumber]
        );
        
        if (result.rows.length === 0) {
            console.error('❌ User not found');
            process.exit(1);
        }
        
        console.log('✅ PIN reset successfully!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Email: ${result.rows[0].email}`);
        console.log(`New PIN: ${newPin}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n💡 You can now log in with this PIN.');
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

resetPin();


