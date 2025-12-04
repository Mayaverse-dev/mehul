require('dotenv').config();
const { Pool } = require('pg');

console.log('🔄 Updating test backer on Railway...\n');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    console.error('Please set it in your .env file or as an environment variable.');
    process.exit(1);
}

async function updateTestBacker() {
    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        console.log('✓ Connected to Railway database\n');

        // Update test backer
        const result = await pool.query(
            `UPDATE users 
             SET reward_title = $1,
                 pledge_amount = $2,
                 backing_minimum = $3,
                 kickstarter_items = $4,
                 kickstarter_addons = $5
             WHERE email = $6
             RETURNING email, backer_number, reward_title, pledge_amount`,
            [
                'The Benevolent Divya',
                190.00,
                190.00,
                JSON.stringify({
                    ebook: 1,
                    hardcover: 1,
                    audiobook: 1,
                    book2_hardcover: 1,
                    book3_hardcover: 1,
                    book2_live: 1,
                    book3_live: 1,
                    lorebook: 1,
                    built_env: 1,
                    pendant: 1
                }),
                JSON.stringify({
                    'Flitt Locust Pendant': 1,
                    'audiobook_addon': 0,
                    'built_env_addon': 0,
                    'lorebook_addon': 0
                }),
                'testbacker@maya.com'
            ]
        );

        if (result.rows.length > 0) {
            console.log('============================================================');
            console.log('✅ TEST BACKER UPDATED SUCCESSFULLY!');
            console.log('============================================================\n');
            console.log('📧 Email:', result.rows[0].email);
            console.log('🎫 Backer #:', result.rows[0].backer_number);
            console.log('🎁 Pledge:', result.rows[0].reward_title);
            console.log('💰 Amount: $' + result.rows[0].pledge_amount);
            console.log('\n🎉 Test backer is ready to use!\n');
            console.log('============================================================\n');
        } else {
            console.log('⚠️  No user found with email: testbacker@maya.com');
            console.log('The test backer might not exist in the Railway database yet.\n');
        }

        await pool.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

updateTestBacker();

