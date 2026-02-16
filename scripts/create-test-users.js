#!/usr/bin/env node
/**
 * Create 10 test users as exact replicas of diverse real users
 * All test users have PIN: 1234 and names ending with "test"
 */

const bcrypt = require('bcrypt');
require('dotenv').config();

const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:hSLlXKyfXiMsDHcGqCmcSXJXdrxJqnIJ@caboose.proxy.rlwy.net:49852/railway'
});

// 10 diverse source user IDs to copy
const SOURCE_USER_IDS = [
    7,     // Founders tier ($1500, pledged)
    17,    // Humble Vaanar ($18, pledged) 
    62,    // Collected user with has_completed=1
    14,    // Dropped user (Founders tier)
    8721,  // Late pledge user
    31,    // Resplendent Garuda tier ($99)
    45,    // Industrious Manushya tier ($35)
    23,    // Benevolent Divya tier ($150)
    35,    // $1 pledge user
    8728   // User with audiobook addon
];

async function createTestUsers() {
    const client = await pool.connect();
    
    try {
        // Hash PIN 1234
        const pinHash = await bcrypt.hash('1234', 10);
        
        // Get max backer number to create unique test backer numbers
        const maxResult = await client.query('SELECT MAX(backer_number) as max_bn FROM users');
        let nextBackerNumber = (maxResult.rows[0].max_bn || 0) + 1000;
        
        console.log('Creating 10 test users with PIN: 1234\n');
        
        for (const sourceId of SOURCE_USER_IDS) {
            // Fetch source user
            const sourceResult = await client.query(
                'SELECT * FROM users WHERE id = $1',
                [sourceId]
            );
            
            if (sourceResult.rows.length === 0) {
                console.log(`⚠️  Source user ID ${sourceId} not found, skipping`);
                continue;
            }
            
            const source = sourceResult.rows[0];
            
            // Create test user data
            const testName = `${source.backer_name} test`;
            const testEmail = `test_${source.backer_number}@testmaya.com`;
            const testBackerNumber = nextBackerNumber++;
            
            // Check if test email already exists
            const existingCheck = await client.query(
                'SELECT id FROM users WHERE email = $1',
                [testEmail]
            );
            
            if (existingCheck.rows.length > 0) {
                console.log(`⏭️  Test user for ${source.backer_name} already exists, skipping`);
                continue;
            }
            
            // Insert test user
            await client.query(`
                INSERT INTO users (
                    email, password, backer_number, backer_uid, backer_name,
                    reward_title, backing_minimum, pledge_amount,
                    kickstarter_items, kickstarter_addons, shipping_country,
                    has_completed, pledged_status, amount_due, amount_paid,
                    pledge_over_time, is_late_pledge, pin_hash
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8,
                    $9, $10, $11,
                    $12, $13, $14, $15,
                    $16, $17, $18
                )
            `, [
                testEmail,
                'test_password_hash',
                testBackerNumber,
                `test_uid_${testBackerNumber}`,
                testName,
                source.reward_title,
                source.backing_minimum,
                source.pledge_amount,
                source.kickstarter_items,
                source.kickstarter_addons,
                source.shipping_country,
                source.has_completed,
                source.pledged_status,
                source.amount_due,
                source.amount_paid,
                source.pledge_over_time,
                source.is_late_pledge,
                pinHash
            ]);
            
            console.log(`✅ Created: ${testName}`);
            console.log(`   Email: ${testEmail}`);
            console.log(`   Backer #: ${testBackerNumber}`);
            console.log(`   Tier: ${source.reward_title || 'N/A'}`);
            console.log(`   Pledge: $${source.pledge_amount}`);
            console.log(`   Status: ${source.pledged_status}`);
            console.log(`   Late Pledge: ${source.is_late_pledge ? 'Yes' : 'No'}`);
            console.log(`   Completed: ${source.has_completed ? 'Yes' : 'No'}`);
            console.log('');
        }
        
        console.log('\n🎉 Done! All test users have PIN: 1234');
        
    } catch (error) {
        console.error('Error:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

createTestUsers().catch(console.error);
