require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

console.log('🧪 Creating test user...\n');

// Connect to database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Error opening database:', err);
        process.exit(1);
    }
});

async function createTestUser() {
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

    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(testUser.password, 10);

        // Check if test user already exists
        db.get('SELECT * FROM users WHERE email = ?', [testUser.email], (err, row) => {
            if (err) {
                console.error('❌ Error checking for existing user:', err);
                db.close();
                process.exit(1);
            }

            if (row) {
                console.log('ℹ️  Test user already exists. Updating...\n');
                
                // Update existing user
                db.run(`UPDATE users SET 
                    password = ?,
                    backer_number = ?,
                    backer_uid = ?,
                    backer_name = ?,
                    reward_title = ?,
                    backing_minimum = ?,
                    pledge_amount = ?,
                    kickstarter_items = ?,
                    kickstarter_addons = ?,
                    shipping_country = ?
                    WHERE email = ?`,
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
                ],
                (err) => {
                    if (err) {
                        console.error('❌ Error updating user:', err);
                    } else {
                        printSuccess(testUser);
                    }
                    db.close();
                });
            } else {
                // Insert new user
                db.run(`INSERT INTO users (
                    email, password, backer_number, backer_uid, backer_name,
                    reward_title, backing_minimum, pledge_amount,
                    kickstarter_items, kickstarter_addons, shipping_country
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                ],
                (err) => {
                    if (err) {
                        console.error('❌ Error creating user:', err);
                    } else {
                        printSuccess(testUser);
                    }
                    db.close();
                });
            }
        });
    } catch (error) {
        console.error('❌ Error:', error);
        db.close();
        process.exit(1);
    }
}

function printSuccess(user) {
    console.log('='.repeat(60));
    console.log('✅ TEST USER CREATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📧 Email:    ' + user.email);
    console.log('🔑 Password: ' + user.password);
    console.log('');
    console.log('🎫 Pledge Info:');
    console.log('   - Tier: ' + user.reward_title);
    console.log('   - Amount: $' + user.pledge_amount.toFixed(2));
    console.log('   - Backer #' + user.backer_number);
    console.log('');
    console.log('📦 Kickstarter Items:');
    console.log('   - 1x MAYA: Seed Takes Root ebook');
    console.log('   - 1x MAYA: Seed Takes Root Hardcover');
    console.log('   - 1x MAYA: Seed Takes Root Audiobook');
    console.log('   - 1x MAYA: Whispers In The Soil | Book 2 Hardcover');
    console.log('   - 1x MAYA: It Becomes The Forest | Book 3 Hardcover');
    console.log('   - 1x MAYA Lorebook');
    console.log('   - 1x Built Environments of MAYA Hardcover');
    console.log('   - 1x Flitt Locust Pendant');
    console.log('');
    console.log('🌐 Login at: http://localhost:3000');
    console.log('');
    console.log('='.repeat(60));
    console.log('');
    console.log('🧪 Test the complete flow:');
    console.log('   1. Login with the credentials above');
    console.log('   2. View your Kickstarter pledge on dashboard');
    console.log('   3. Browse and add some add-ons');
    console.log('   4. Enter shipping address');
    console.log('   5. Test payment with Stripe test card:');
    console.log('      Card: 4242 4242 4242 4242');
    console.log('      Exp:  Any future date (e.g., 12/25)');
    console.log('      CVC:  Any 3 digits (e.g., 123)');
    console.log('');
    console.log('🎉 Happy testing!');
    console.log('='.repeat(60));
    console.log('');
}

createTestUser();









