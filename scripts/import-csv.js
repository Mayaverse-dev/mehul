require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Database setup - PostgreSQL or SQLite
let pool = null;
let db = null;
let isPostgres = false;

if (process.env.DATABASE_URL) {
    // Use PostgreSQL
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    isPostgres = true;
    console.log('✓ Using PostgreSQL database');
} else {
    // Fallback to SQLite
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./database.db', (err) => {
        if (err) {
            console.error('❌ Error opening database:', err);
            process.exit(1);
        }
        console.log('✓ Using SQLite database');
    });
}

// Database query wrapper
async function query(sql, params = []) {
    if (isPostgres) {
        // Convert ? to $1, $2, etc. for PostgreSQL
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        const result = await pool.query(pgSql, params);
        return result.rows;
    } else {
        // SQLite
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

// Check if CSV file path is provided
if (process.argv.length < 3) {
    console.error('❌ Please provide the path to the Kickstarter CSV file');
    console.log('\nUsage: npm run import-csv path-to-kickstarter.csv');
    console.log('\nFor Railway: railway run npm run import-csv path-to-kickstarter.csv');
    process.exit(1);
}

const csvFilePath = process.argv[2];

// Check if file exists
if (!fs.existsSync(csvFilePath)) {
    console.error('❌ File not found:', csvFilePath);
    process.exit(1);
}

console.log('📂 Reading CSV file:', csvFilePath);

// Generate random password (placeholder for legacy column)
function generatePassword(length = 12) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

// Item name mappings (adjust these based on your actual Kickstarter CSV column names)
const itemColumns = {
    'MAYA : Seed Takes Root ebook (Edition Zero)': 'ebook',
    'MAYA : Seed Takes Root Paperback (Edition Zero)': 'paperback',
    'MAYA : Seed Takes Root Audiobook (Narrated by Hugo Weaving)': 'audiobook',
    'MAYA : Seed Takes Root Hardcover (Edition Zero)': 'hardcover',
    'MAYA : Whispers In The Soil | Book 2 Hardcover': 'book2_hardcover',
    'MAYA : It Becomes The Forest | Book 3 Hardcover': 'book3_hardcover',
    'MAYA Lore : It\'s Species And Their Cultures (Edition Zero)': 'lorebook',
    'Built Environments of MAYA Hardcover (Phase 1 & 2)': 'built_env',
    'Flitt Locust Pendant': 'pendant',
    'Limited Edition MAYA Art Book': 'art_book',
    'MAYA : Whispers In The Soil | Book 2 Live Access': 'book2_live',
    'MAYA : It Becomes The Forest | Book 3 Live Access': 'book3_live'
};

const addonColumns = {
    '[Addon: 10750435] Flitt Locust Pendant': 'pendant',
    '[Addon: 10750413] MAYA: Seed Takes Root Audiobook': 'audiobook_addon',
    '[Addon: 10753939] Built Environments of MAYA Hardcover': 'built_env_addon',
    '[Addon: 10753941] MAYA Lorebook': 'lorebook_addon'
};

// Parse CSV and import data
let importedCount = 0;
let errorCount = 0;
let emailsSent = 0;

const rows = [];

fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
        rows.push(row);
    })
    .on('end', async () => {
        console.log(`\n📊 Found ${rows.length} rows in CSV\n`);
        console.log('🔄 Processing backers...\n');

        for (const row of rows) {
            try {
                const email = row['Email'];
                
                // Skip if no email
                if (!email || email.trim() === '') {
                    continue;
                }

                // Extract basic info
                const backerNumber = parseInt(row['Backer Number']) || null;
                const backerUID = row['Backer UID'];
                const backerName = row['Backer Name'];
                const rewardTitle = row['Reward Title'];
                const backingMinimum = parseFloat(row['Backing Minimum']?.replace(/[$,]/g, '')) || 0;
                const pledgeAmount = parseFloat(row['Pledge Amount']?.replace(/[$,]/g, '')) || 0;
                const shippingCountry = row['Shipping Country'];

                // Parse Kickstarter items
                const items = {};
                for (const [columnName, itemKey] of Object.entries(itemColumns)) {
                    const quantity = parseInt(row[columnName]) || 0;
                    if (quantity > 0) {
                        items[itemKey] = quantity;
                    }
                }

                // Parse Kickstarter add-ons
                const addons = {};
                for (const [columnName, addonKey] of Object.entries(addonColumns)) {
                    const quantity = parseInt(row[columnName]) || 0;
                    if (quantity > 0) {
                        addons[addonKey] = quantity;
                    }
                }

                // Generate placeholder password (legacy column only)
                const password = generatePassword();
                const hashedPassword = await bcrypt.hash(password, 10);

                // Insert into database
                await query(`INSERT INTO users (
                    email, password, backer_number, backer_uid, backer_name,
                    reward_title, backing_minimum, pledge_amount,
                    kickstarter_items, kickstarter_addons, shipping_country
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    password = excluded.password,
                    backer_number = excluded.backer_number,
                    backer_uid = excluded.backer_uid,
                    backer_name = excluded.backer_name,
                    reward_title = excluded.reward_title,
                    backing_minimum = excluded.backing_minimum,
                    pledge_amount = excluded.pledge_amount,
                    kickstarter_items = excluded.kickstarter_items,
                    kickstarter_addons = excluded.kickstarter_addons,
                    shipping_country = excluded.shipping_country`,
                [
                    email,
                    hashedPassword,
                    backerNumber,
                    backerUID,
                    backerName,
                    rewardTitle,
                    backingMinimum,
                    pledgeAmount,
                    JSON.stringify(items),
                    JSON.stringify(addons),
                    shippingCountry
                ]);

                importedCount++;

                // Progress indicator
                if (importedCount % 10 === 0) {
                    process.stdout.write(`✓ Imported ${importedCount} backers...\r`);
                }

            } catch (error) {
                errorCount++;
                console.error(`\n❌ Error importing ${row['Email']}:`, error.message);
            }
        }

        console.log('\n\n' + '='.repeat(60));
        console.log('📊 IMPORT COMPLETE');
        console.log('='.repeat(60));
        console.log(`✓ Successfully imported: ${importedCount} backers`);
        console.log(`📧 Emails sent: ${emailsSent}`);
        if (errorCount > 0) {
            console.log(`❌ Errors: ${errorCount}`);
        }
        console.log('='.repeat(60) + '\n');

        // Close database connections
        if (isPostgres && pool) {
            await pool.end();
        } else if (db) {
            db.close();
        }
        process.exit(0);
    })
    .on('error', (error) => {
        console.error('❌ Error reading CSV file:', error);
        process.exit(1);
    });
