/**
 * Script to update late backers with proper kickstarter_items and kickstarter_addons
 * Reads from late-backers.csv and updates the database
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:hSLlXKyfXiMsDHcGqCmcSXJXdrxJqnIJ@caboose.proxy.rlwy.net:49852/railway'
});

const { CSV_ITEM_COLUMNS: ITEM_COLUMNS, CSV_ADDON_COLUMNS } = require('../config/tier-items');

// Late backers CSV uses slightly different addon key format (no _addon suffix)
const ADDON_COLUMNS = {};
for (const [csvCol, key] of Object.entries(CSV_ADDON_COLUMNS)) {
    ADDON_COLUMNS[csvCol] = key.replace(/_addon$/, '');
}

async function updateLateBackers() {
    const csvPath = path.join(__dirname, '..', 'late-backers.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error('late-backers.csv not found!');
        process.exit(1);
    }
    
    const backers = [];
    
    // Parse CSV
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => {
                const email = row['Email']?.trim().toLowerCase();
                if (!email) return;
                
                // Build kickstarter_items object
                const kickstarterItems = {};
                for (const [csvCol, itemKey] of Object.entries(ITEM_COLUMNS)) {
                    const val = parseInt(row[csvCol]) || 0;
                    if (val > 0) {
                        // Accumulate if same key appears multiple times (shouldn't happen but be safe)
                        kickstarterItems[itemKey] = (kickstarterItems[itemKey] || 0) + val;
                    }
                }
                
                // Build kickstarter_addons object
                const kickstarterAddons = {};
                for (const [csvCol, addonKey] of Object.entries(ADDON_COLUMNS)) {
                    const val = parseInt(row[csvCol]) || 0;
                    if (val > 0) {
                        kickstarterAddons[addonKey] = (kickstarterAddons[addonKey] || 0) + val;
                    }
                }
                
                // Also extract backer_number which was missing
                const backerNumber = parseInt(row['Backer Number']) || null;
                
                backers.push({
                    email,
                    backerNumber,
                    kickstarterItems: JSON.stringify(kickstarterItems),
                    kickstarterAddons: JSON.stringify(kickstarterAddons),
                    rewardTitle: row['Reward Title']?.trim()
                });
            })
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`Parsed ${backers.length} late backers from CSV`);
    
    // Update database
    let updated = 0;
    let notFound = 0;
    let errors = 0;
    
    for (const backer of backers) {
        try {
            // Check if user exists
            const existing = await pool.query(
                'SELECT id, email, kickstarter_items FROM users WHERE LOWER(email) = $1',
                [backer.email]
            );
            
            if (existing.rows.length === 0) {
                console.log(`  ⚠ User not found in DB: ${backer.email}`);
                notFound++;
                continue;
            }
            
            const userId = existing.rows[0].id;
            
            // Update user with kickstarter_items, kickstarter_addons, and backer_number
            await pool.query(`
                UPDATE users 
                SET kickstarter_items = $1,
                    kickstarter_addons = $2,
                    backer_number = COALESCE(backer_number, $3)
                WHERE id = $4
            `, [backer.kickstarterItems, backer.kickstarterAddons, backer.backerNumber, userId]);
            
            updated++;
            
            // Log details for first few
            if (updated <= 5) {
                console.log(`  ✓ Updated ${backer.email}:`);
                console.log(`    Items: ${backer.kickstarterItems}`);
                console.log(`    Addons: ${backer.kickstarterAddons}`);
            }
        } catch (err) {
            console.error(`  ✗ Error updating ${backer.email}:`, err.message);
            errors++;
        }
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Total in CSV: ${backers.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Not found in DB: ${notFound}`);
    console.log(`Errors: ${errors}`);
    
    // Verify Mike Bradley specifically
    console.log('\n=== VERIFICATION: mike.bradley.1987@gmail.com ===');
    const mike = await pool.query(
        'SELECT email, reward_title, kickstarter_items, kickstarter_addons, backer_number FROM users WHERE LOWER(email) = $1',
        ['mike.bradley.1987@gmail.com']
    );
    if (mike.rows[0]) {
        console.log(JSON.stringify(mike.rows[0], null, 2));
    }
    
    await pool.end();
}

updateLateBackers().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
