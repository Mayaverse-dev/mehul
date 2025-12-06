require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const testUser = {
    email: 'mehul.entermaya@gmail.com',
    password: 'test123',
    backer_number: 9999,
    backer_uid: 'TEST123',
    backer_name: 'Test Backer',
    reward_title: 'The Benevolent Divya',
    backing_minimum: 190.00,
    pledge_amount: 190.00,
    kickstarter_items: JSON.stringify({
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
    kickstarter_addons: JSON.stringify({
        'Flitt Locust Pendant': 1,
        audiobook_addon: 0,
        built_env_addon: 0,
        lorebook_addon: 0
    }),
    shipping_country: 'US'
};

async function createTestUser() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        // Check if user exists
        const existing = await pool.query('SELECT id, email FROM users WHERE email = $1', [testUser.email]);
        
        if (existing.rows.length > 0) {
            console.log('ℹ️  Test user already exists. Updating...');
            const hashedPassword = await bcrypt.hash(testUser.password, 10);
            await pool.query(`UPDATE users SET 
                password = $1,
                backer_number = $2,
                backer_uid = $3,
                backer_name = $4,
                reward_title = $5,
                backing_minimum = $6,
                pledge_amount = $7,
                kickstarter_items = $8,
                kickstarter_addons = $9,
                shipping_country = $10
                WHERE email = $11`,
            [
                hashedPassword,
                testUser.backer_number,
                testUser.backer_uid,
                testUser.backer_name,
                testUser.reward_title,
                testUser.backing_minimum,
                testUser.pledge_amount,
                testUser.kickstarter_items,
                testUser.kickstarter_addons,
                testUser.shipping_country,
                testUser.email
            ]);
            console.log('✅ Test user updated successfully!');
        } else {
            console.log('Creating new test user...');
            const hashedPassword = await bcrypt.hash(testUser.password, 10);
            await pool.query(`INSERT INTO users (
                email, password, backer_number, backer_uid, backer_name,
                reward_title, backing_minimum, pledge_amount,
                kickstarter_items, kickstarter_addons, shipping_country
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                testUser.email,
                hashedPassword,
                testUser.backer_number,
                testUser.backer_uid,
                testUser.backer_name,
                testUser.reward_title,
                testUser.backing_minimum,
                testUser.pledge_amount,
                testUser.kickstarter_items,
                testUser.kickstarter_addons,
                testUser.shipping_country
            ]);
            console.log('✅ Test user created successfully!');
        }
        
        console.log(`\n📧 Email: ${testUser.email}`);
        console.log(`🔑 Password: ${testUser.password}`);
        
        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

createTestUser();

