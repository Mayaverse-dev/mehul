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

async function lookupUser() {
    try {
        const backerNumber = 3159;
        const name = 'Renjee Philip';
        
        console.log(`🔍 Looking up backer #${backerNumber} - ${name}...\n`);
        
        // Try by backer number first
        let result = await pool.query(
            'SELECT * FROM users WHERE backer_number = $1',
            [backerNumber]
        );
        
        if (result.rows.length === 0) {
            // Try by name
            result = await pool.query(
                'SELECT * FROM users WHERE backer_name ILIKE $1',
                [`%${name}%`]
            );
        }
        
        if (result.rows.length === 0) {
            console.log('❌ User not found');
            process.exit(1);
        }
        
        const user = result.rows[0];
        
        console.log('✅ Found user:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`ID: ${user.id}`);
        console.log(`Email: ${user.email}`);
        console.log(`Backer Number: ${user.backer_number}`);
        console.log(`Backer UID: ${user.backer_uid}`);
        console.log(`Backer Name: ${user.backer_name}`);
        console.log(`Reward Title: ${user.reward_title || 'N/A'}`);
        console.log(`Pledge Amount: $${user.pledge_amount || 0}`);
        console.log(`Backing Minimum: $${user.backing_minimum || 0}`);
        console.log(`Pledged Status: ${user.pledged_status || 'N/A'}`);
        console.log(`Kickstarter Items: ${user.kickstarter_items || 'N/A'}`);
        console.log(`Kickstarter Addons: ${user.kickstarter_addons || 'N/A'}`);
        console.log(`Last Login: ${user.last_login_at || 'Never'}`);
        console.log(`Created At: ${user.created_at || 'N/A'}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

lookupUser();


