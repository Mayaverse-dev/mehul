/**
 * Comprehensive script to sync ALL late backer fields from CSV to database
 * 
 * This syncs: backer_uid, backer_name, pledge_amount, shipping_country,
 * pledged_status, amount_due, amount_paid, pledge_over_time
 * 
 * (backer_number, reward_title, backing_minimum, kickstarter_items, 
 * kickstarter_addons were synced by previous scripts)
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
    if (!val || val === '') return null;
    const parsed = parseFloat(val.replace(/[\$,]/g, ''));
    return isNaN(parsed) ? null : parsed;
}

// Helper to parse boolean/yes-no
function parseBoolean(val) {
    if (!val) return 0;
    const lower = val.toString().toLowerCase().trim();
    return (lower === 'true' || lower === 'yes' || lower === '1') ? 1 : 0;
}

async function syncAllFields() {
    const csvPath = path.join(__dirname, '..', 'late-backers.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error('late-backers.csv not found!');
        process.exit(1);
    }
    
    // Step 1: Parse CSV with BOM handling - extract ALL fields
    console.log('=== STEP 1: Parsing CSV (all fields) ===');
    const csvBackers = new Map();
    
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                const data = {};
                
                for (const [key, value] of Object.entries(row)) {
                    const cleanedKey = cleanKey(key);
                    
                    if (cleanedKey === 'email') data.email = value?.trim().toLowerCase();
                    if (cleanedKey === 'backer number') data.backerNumber = parseInt(value) || null;
                    if (cleanedKey === 'backer uid') data.backerUid = value?.trim() || null;
                    if (cleanedKey === 'backer name') data.backerName = value?.trim() || null;
                    if (cleanedKey === 'shipping country') data.shippingCountry = value?.trim() || null;
                    if (cleanedKey === 'reward title') data.rewardTitle = value?.trim() || null;
                    if (cleanedKey === 'backing minimum') data.backingMinimum = parseCurrency(value);
                    if (cleanedKey === 'pledge amount') data.pledgeAmount = parseCurrency(value);
                    if (cleanedKey === 'amount due') data.amountDue = parseCurrency(value);
                    if (cleanedKey === 'amount paid') data.amountPaid = parseCurrency(value);
                    if (cleanedKey === 'pledged status') data.pledgedStatus = value?.trim().toLowerCase() || null;
                    if (cleanedKey === 'pledge over time') data.pledgeOverTime = parseBoolean(value);
                }
                
                if (data.email) {
                    csvBackers.set(data.email, data);
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`Parsed ${csvBackers.size} late backers from CSV`);
    
    // Step 2: Get all late backers from DB
    console.log('\n=== STEP 2: Fetching DB records ===');
    const dbBackers = await pool.query(
        `SELECT id, email, backer_number, backer_uid, backer_name, 
                shipping_country, reward_title, backing_minimum, pledge_amount,
                amount_due, amount_paid, pledged_status, pledge_over_time
         FROM users WHERE is_late_pledge = 1`
    );
    console.log(`Found ${dbBackers.rows.length} late backers in DB`);
    
    // Step 3: Find all differences
    console.log('\n=== STEP 3: Analyzing differences ===');
    const updates = [];
    
    for (const dbUser of dbBackers.rows) {
        const email = dbUser.email.toLowerCase();
        const csvData = csvBackers.get(email);
        
        if (!csvData) {
            continue;
        }
        
        const changes = {};
        
        // Check each field
        if (dbUser.backer_number !== csvData.backerNumber) {
            changes.backer_number = { from: dbUser.backer_number, to: csvData.backerNumber };
        }
        if (dbUser.backer_uid !== csvData.backerUid) {
            changes.backer_uid = { from: dbUser.backer_uid, to: csvData.backerUid };
        }
        if (dbUser.backer_name !== csvData.backerName) {
            changes.backer_name = { from: dbUser.backer_name, to: csvData.backerName };
        }
        if (dbUser.shipping_country !== csvData.shippingCountry) {
            changes.shipping_country = { from: dbUser.shipping_country, to: csvData.shippingCountry };
        }
        if (dbUser.reward_title !== csvData.rewardTitle) {
            changes.reward_title = { from: dbUser.reward_title, to: csvData.rewardTitle };
        }
        if (dbUser.backing_minimum !== csvData.backingMinimum) {
            changes.backing_minimum = { from: dbUser.backing_minimum, to: csvData.backingMinimum };
        }
        if (dbUser.pledge_amount !== csvData.pledgeAmount) {
            changes.pledge_amount = { from: dbUser.pledge_amount, to: csvData.pledgeAmount };
        }
        if (dbUser.amount_due !== csvData.amountDue) {
            changes.amount_due = { from: dbUser.amount_due, to: csvData.amountDue };
        }
        if (dbUser.amount_paid !== csvData.amountPaid) {
            changes.amount_paid = { from: dbUser.amount_paid, to: csvData.amountPaid };
        }
        if (dbUser.pledged_status !== csvData.pledgedStatus) {
            changes.pledged_status = { from: dbUser.pledged_status, to: csvData.pledgedStatus };
        }
        if (dbUser.pledge_over_time !== csvData.pledgeOverTime) {
            changes.pledge_over_time = { from: dbUser.pledge_over_time, to: csvData.pledgeOverTime };
        }
        
        if (Object.keys(changes).length > 0) {
            updates.push({
                id: dbUser.id,
                email,
                changes,
                csvData
            });
        }
    }
    
    console.log(`Found ${updates.length} users that need updating`);
    
    // Count changes by field
    const fieldCounts = {};
    updates.forEach(u => {
        Object.keys(u.changes).forEach(field => {
            fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        });
    });
    console.log('\nChanges by field:');
    Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]).forEach(([field, count]) => {
        console.log(`  ${field}: ${count} users`);
    });
    
    if (updates.length === 0) {
        console.log('\nNo updates needed!');
        await pool.end();
        return;
    }
    
    // Step 4: Show sample of changes
    console.log('\n=== STEP 4: Sample changes (first 5) ===');
    updates.slice(0, 5).forEach((u, i) => {
        console.log(`\n${i + 1}. ${u.email}`);
        Object.entries(u.changes).forEach(([field, change]) => {
            console.log(`   ${field}: "${change.from}" → "${change.to}"`);
        });
    });
    
    // Step 5: Apply ALL updates
    console.log('\n=== STEP 5: Applying updates ===');
    let updated = 0;
    let errors = 0;
    
    for (const u of updates) {
        try {
            await pool.query(
                `UPDATE users 
                 SET backer_number = $1,
                     backer_uid = $2,
                     backer_name = $3,
                     shipping_country = $4,
                     reward_title = $5,
                     backing_minimum = $6,
                     pledge_amount = $7,
                     amount_due = $8,
                     amount_paid = $9,
                     pledged_status = $10,
                     pledge_over_time = $11
                 WHERE id = $12`,
                [
                    u.csvData.backerNumber,
                    u.csvData.backerUid,
                    u.csvData.backerName,
                    u.csvData.shippingCountry,
                    u.csvData.rewardTitle,
                    u.csvData.backingMinimum,
                    u.csvData.pledgeAmount,
                    u.csvData.amountDue,
                    u.csvData.amountPaid,
                    u.csvData.pledgedStatus,
                    u.csvData.pledgeOverTime,
                    u.id
                ]
            );
            updated++;
            if (updated <= 10 || updated % 50 === 0) {
                console.log(`  ✓ Updated ${u.email} (${Object.keys(u.changes).length} fields)`);
            }
        } catch (err) {
            errors++;
            console.error(`  ✗ Error updating ${u.email}:`, err.message);
        }
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    
    // Step 6: Verify specific users
    console.log('\n=== STEP 6: Verification ===');
    
    const testUsers = ['mrjacobhoffer@gmail.com', '9289v5gwfm@privaterelay.appleid.com'];
    for (const email of testUsers) {
        const user = await pool.query(
            `SELECT email, backer_number, backer_uid, backer_name, shipping_country,
                    reward_title, backing_minimum, pledge_amount, pledged_status
             FROM users WHERE LOWER(email) = $1`,
            [email.toLowerCase()]
        );
        if (user.rows[0]) {
            console.log(`\n${email}:`);
            console.log(JSON.stringify(user.rows[0], null, 2));
        }
    }
    
    // Final stats
    const stats = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(backer_uid) as with_backer_uid,
            COUNT(backer_name) as with_backer_name,
            COUNT(pledge_amount) as with_pledge_amount,
            COUNT(shipping_country) as with_shipping_country,
            COUNT(pledged_status) as with_pledged_status
        FROM users 
        WHERE is_late_pledge = 1
    `);
    console.log('\n=== FINAL STATS (late backers) ===');
    console.log(`Total: ${stats.rows[0].total}`);
    console.log(`With backer_uid: ${stats.rows[0].with_backer_uid}`);
    console.log(`With backer_name: ${stats.rows[0].with_backer_name}`);
    console.log(`With pledge_amount: ${stats.rows[0].with_pledge_amount}`);
    console.log(`With shipping_country: ${stats.rows[0].with_shipping_country}`);
    console.log(`With pledged_status: ${stats.rows[0].with_pledged_status}`);
    
    await pool.end();
}

syncAllFields().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
