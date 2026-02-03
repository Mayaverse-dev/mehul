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

// Column mappings from CSV to our internal keys
const ADDON_COLUMNS = {
    '[Addon: 10750435] Flitt Locust Pendant': 'pendant',
    '[Addon: 10750413] MAYA: Seed Takes Root Audiobook': 'audiobook',
    '[Addon: 10753939] Built Environments of MAYA Hardcover': 'built_env',
    '[Addon: 10753941] MAYA Lorebook': 'lorebook'
};

const ITEM_COLUMNS = {
    'MAYA : Seed Takes Root ebook (Edition Zero)': 'ebook',
    'MAYA : Seed Takes Root Paperback (Edition Zero)': 'paperback',
    'MAYA : Seed Takes Root Audiobook (Narrated by Hugo Weaving)': 'audiobook',
    'MAYA : Seed Takes Root Hardcover (Edition Zero)': 'hardcover',
    'MAYA : Whispers In The Soil | Book 2 Live Access': 'book2_live',
    'MAYA : It Becomes The Forest | Book 3 Live Access': 'book3_live',
    'MAYA : Whispers In The Soil | Book 2 Hardcover': 'book2_hardcover',
    'MAYA : It Becomes The Forest | Book 3 Hardcover': 'book3_hardcover',
    'MAYA Lore : It\'s Species And Their Cultures (Edition Zero)': 'lorebook',
    'Built Environments of MAYA Hardcover (Phase 1 & 2)': 'built_env',
    'Flitt Locust Pendant': 'pendant',
    'Limited Edition MAYA Art Book': 'art_book'
};

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
