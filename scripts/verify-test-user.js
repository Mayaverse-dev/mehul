require('dotenv').config();
const { Pool } = require('pg');

async function verifyTestUser() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        const result = await pool.query(
            'SELECT id, email, backer_name, backer_number FROM users WHERE email = $1',
            ['mehul.entermaya@gmail.com']
        );
        
        if (result.rows.length > 0) {
            console.log('✅ Test user found:');
            console.log(JSON.stringify(result.rows[0], null, 2));
        } else {
            console.log('⚠️  Test user not found. Creating...');
            // User creation would go here if needed
        }
        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

verifyTestUser();

