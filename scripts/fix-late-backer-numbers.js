/**
 * Script to fix backer_number for late backers
 * The previous script failed due to BOM character in CSV header
 * This script handles BOM and ONLY updates backer_number
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:hSLlXKyfXiMsDHcGqCmcSXJXdrxJqnIJ@caboose.proxy.rlwy.net:49852/railway'
});

async function fixBackerNumbers() {
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
                // Handle BOM in column names - find the backer number column
                let backerNumber = null;
                let email = null;
                
                for (const [key, value] of Object.entries(row)) {
                    // Strip BOM and whitespace from key for comparison
                    const cleanKey = key.replace(/^\ufeff/, '').trim().toLowerCase();
                    
                    if (cleanKey === 'backer number') {
                        backerNumber = parseInt(value) || null;
                    }
                    if (cleanKey === 'email') {
                        email = value?.trim().toLowerCase();
                    }
                }
                
                if (email && backerNumber) {
                    backers.push({ email, backerNumber });
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });
    
    console.log(`Parsed ${backers.length} late backers with backer numbers from CSV`);
    
    // Show first 3 for verification
    console.log('\nFirst 3 entries (for verification):');
    backers.slice(0, 3).forEach(b => {
        console.log(`  ${b.email} -> backer_number: ${b.backerNumber}`);
    });
    
    // Find Mike specifically
    const mike = backers.find(b => b.email.includes('mike.bradley'));
    if (mike) {
        console.log(`\nMike Bradley found: backer_number = ${mike.backerNumber}`);
    } else {
        console.log('\nWARNING: Mike Bradley not found in parsed data!');
    }
    
    // Dry run - check how many need updating
    console.log('\n=== DRY RUN - Checking database ===');
    let needsUpdate = 0;
    let alreadySet = 0;
    let notFound = 0;
    
    for (const backer of backers) {
        const existing = await pool.query(
            'SELECT id, backer_number FROM users WHERE LOWER(email) = $1',
            [backer.email]
        );
        
        if (existing.rows.length === 0) {
            notFound++;
        } else if (existing.rows[0].backer_number === null) {
            needsUpdate++;
        } else {
            alreadySet++;
        }
    }
    
    console.log(`  Needs update (backer_number is NULL): ${needsUpdate}`);
    console.log(`  Already has backer_number: ${alreadySet}`);
    console.log(`  Not found in DB: ${notFound}`);
    
    if (needsUpdate === 0) {
        console.log('\nNo updates needed!');
        await pool.end();
        return;
    }
    
    // Actual update
    console.log('\n=== UPDATING DATABASE ===');
    let updated = 0;
    let errors = 0;
    
    for (const backer of backers) {
        try {
            const result = await pool.query(
                'UPDATE users SET backer_number = $1 WHERE LOWER(email) = $2 AND backer_number IS NULL',
                [backer.backerNumber, backer.email]
            );
            
            if (result.rowCount > 0) {
                updated++;
                if (updated <= 5) {
                    console.log(`  ✓ Updated ${backer.email} -> backer_number: ${backer.backerNumber}`);
                }
            }
        } catch (err) {
            console.error(`  ✗ Error updating ${backer.email}:`, err.message);
            errors++;
        }
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Updated: ${updated}`);
    console.log(`Errors: ${errors}`);
    
    // Verify Mike Bradley specifically
    console.log('\n=== VERIFICATION: mike.bradley.1987@gmail.com ===');
    const mikeVerify = await pool.query(
        'SELECT email, backer_number, reward_title, is_late_pledge FROM users WHERE LOWER(email) = $1',
        ['mike.bradley.1987@gmail.com']
    );
    if (mikeVerify.rows[0]) {
        console.log(JSON.stringify(mikeVerify.rows[0], null, 2));
    }
    
    // Final stats
    const finalStats = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(backer_number) as with_backer_number
        FROM users 
        WHERE is_late_pledge = 1
    `);
    console.log('\n=== FINAL LATE BACKER STATS ===');
    console.log(`Total late backers: ${finalStats.rows[0].total}`);
    console.log(`With backer_number: ${finalStats.rows[0].with_backer_number}`);
    
    await pool.end();
}

fixBackerNumbers().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
