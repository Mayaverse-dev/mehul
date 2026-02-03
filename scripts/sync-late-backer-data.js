/**
 * Script to sync late backer data from CSV to database
 * 
 * This script updates reward_title, backer_number, and backing_minimum
 * for late backers where the CSV has different (more recent) data.
 * 
 * The late-backers.csv is the source of truth for late backers.
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:hSLlXKyfXiMsDHcGqCmcSXJXdrxJqnIJ@caboose.proxy.rlwy.net:49852/railway'
});

// Helper to clean CSV keys (remove BOM)
function cleanKey(key) {
    return key.replace(/^\ufeff/, '').trim().toLowerCase();
}

// Helper to parse currency
function parseCurrency(val) {
    if (!val) return null;
    return parseFloat(val.replace(/[\$,]/g, '')) || null;
}

async function syncLateBacker() {
    const csvPath = path.join(__dirname, '..', 'late-backers.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error('late-backers.csv not found!');
        process.exit(1);
    }
    
    // Step 1: Parse CSV with BOM handling
    console.log('=== STEP 1: Parsing CSV ===');
    const csvBackers = new Map();
    
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                let email = null;
                let rewardTitle = null;
                let backerNumber = null;
                let backingMinimum = null;
                
                for (const [key, value] of Object.entries(row)) {
                    const cleanedKey = cleanKey(key);
                    if (cleanedKey === 'email') email = value?.trim().toLowerCase();
                    if (cleanedKey === 'reward title') rewardTitle = value?.trim() || null;
                    if (cleanedKey === 'backer number') backerNumber = parseInt(value) || null;
                    if (cleanedKey === 'backing minimum') backingMinimum = parseCurrency(value);
                }
                
                if (email && rewardTitle) {  // Only include if we have valid data
                    csvBackers.set(email, { rewardTitle, backerNumber, backingMinimum });
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`Parsed ${csvBackers.size} late backers with valid reward titles from CSV`);
    
    // Step 2: Get all late backers from DB
    console.log('\n=== STEP 2: Fetching DB records ===');
    const dbBackers = await pool.query(
        'SELECT id, email, reward_title, backer_number, backing_minimum FROM users WHERE is_late_pledge = 1'
    );
    console.log(`Found ${dbBackers.rows.length} late backers in DB`);
    
    // Step 3: Find mismatches
    console.log('\n=== STEP 3: Identifying mismatches ===');
    const updates = [];
    
    for (const dbUser of dbBackers.rows) {
        const email = dbUser.email.toLowerCase();
        const csvData = csvBackers.get(email);
        
        if (!csvData) {
            continue;  // User not in CSV, skip
        }
        
        // Check if any field needs updating
        const needsRewardTitle = dbUser.reward_title !== csvData.rewardTitle;
        const needsBackerNumber = dbUser.backer_number !== csvData.backerNumber;
        const needsBackingMinimum = dbUser.backing_minimum !== csvData.backingMinimum;
        
        if (needsRewardTitle || needsBackerNumber || needsBackingMinimum) {
            updates.push({
                id: dbUser.id,
                email,
                before: {
                    reward_title: dbUser.reward_title,
                    backer_number: dbUser.backer_number,
                    backing_minimum: dbUser.backing_minimum
                },
                after: {
                    reward_title: csvData.rewardTitle,
                    backer_number: csvData.backerNumber,
                    backing_minimum: csvData.backingMinimum
                },
                changes: {
                    reward_title: needsRewardTitle,
                    backer_number: needsBackerNumber,
                    backing_minimum: needsBackingMinimum
                }
            });
        }
    }
    
    console.log(`Found ${updates.length} users that need updating`);
    
    if (updates.length === 0) {
        console.log('\nNo updates needed!');
        await pool.end();
        return;
    }
    
    // Step 4: Show all changes that will be made
    console.log('\n=== STEP 4: Changes to be made ===');
    updates.forEach((u, i) => {
        console.log(`\n${i + 1}. ${u.email} (id: ${u.id})`);
        if (u.changes.reward_title) {
            console.log(`   reward_title: "${u.before.reward_title}" → "${u.after.reward_title}"`);
        }
        if (u.changes.backer_number) {
            console.log(`   backer_number: ${u.before.backer_number} → ${u.after.backer_number}`);
        }
        if (u.changes.backing_minimum) {
            console.log(`   backing_minimum: ${u.before.backing_minimum} → ${u.after.backing_minimum}`);
        }
    });
    
    // Step 5: Apply updates
    console.log('\n=== STEP 5: Applying updates ===');
    let updated = 0;
    let errors = 0;
    
    for (const u of updates) {
        try {
            await pool.query(
                `UPDATE users 
                 SET reward_title = $1, 
                     backer_number = $2, 
                     backing_minimum = $3
                 WHERE id = $4`,
                [u.after.reward_title, u.after.backer_number, u.after.backing_minimum, u.id]
            );
            updated++;
            console.log(`  ✓ Updated ${u.email}`);
        } catch (err) {
            errors++;
            console.error(`  ✗ Error updating ${u.email}:`, err.message);
        }
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    
    // Step 6: Verify key users
    console.log('\n=== STEP 6: Verification ===');
    
    // Verify anmahill specifically
    const anmahill = await pool.query(
        'SELECT email, reward_title, backer_number, backing_minimum, kickstarter_items FROM users WHERE LOWER(email) = $1',
        ['anmahill@gmail.com']
    );
    console.log('\nanmahill@gmail.com AFTER update:');
    console.log(JSON.stringify(anmahill.rows[0], null, 2));
    
    // Final count of late backers with valid reward_title
    const stats = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN reward_title IS NOT NULL AND reward_title != '' THEN 1 END) as with_reward_title
        FROM users 
        WHERE is_late_pledge = 1
    `);
    console.log('\nFinal late backer stats:');
    console.log(`  Total: ${stats.rows[0].total}`);
    console.log(`  With reward_title: ${stats.rows[0].with_reward_title}`);
    
    await pool.end();
}

syncLateBacker().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
