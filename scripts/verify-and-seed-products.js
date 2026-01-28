require('dotenv').config();
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();

console.log('\n🔍 Verifying and Seeding Products Database...\n');

// Required pledge prices (from user requirements)
const REQUIRED_PLEDGES = [
    {
        name: 'The Humble Vaanar',
        price: 25,          // Retail price
        backer_price: 18,   // Kickstarter backer price
        weight: 500,
        type: 'pledge',
        description: 'Begin your journey into MAYA with the first part in a planned trilogy. Get the paperback Edition Zero.',
        image: 'humble-vaanar.png',
        active: 1
    },
    {
        name: 'The Industrious Manushya',
        price: 50,          // Retail price
        backer_price: 35,   // Kickstarter backer price
        weight: 700,
        type: 'pledge',
        description: 'Experience the true authorial vision of MAYA. Get the definitive hardcover Edition Zero.',
        image: 'industrious-manushya.png',
        active: 1
    },
    {
        name: 'The Resplendent Garuda',
        price: 150,         // Retail price
        backer_price: 99,   // Kickstarter backer price
        weight: 2100,
        type: 'pledge',
        description: 'Sign up for the entire trilogy! Book 1 will ship after this campaign ends.',
        image: 'resplendant-garuda.png',
        active: 1
    },
    {
        name: 'The Benevolent Divya',
        price: 190,         // Retail price
        backer_price: 150,  // Kickstarter backer price
        weight: 3500,
        type: 'pledge',
        description: 'The complete, expansive MAYA experience. Get everything - in its most glorious form.',
        image: 'benevolent-divya.png',
        active: 1
    },
    {
        name: 'Founders of Neh',
        price: 2000,        // Retail price
        backer_price: 1500, // Kickstarter backer price
        weight: 4500,
        type: 'pledge',
        description: 'Everything in Benevolent Divya plus Limited Edition Signed Artbook and a character named after you.',
        image: 'founders-of-neh.png',
        active: 1
    }
];

// Required add-on prices (from user requirements)
const REQUIRED_ADDONS = [
    {
        name: 'MAYA: Seed Takes Root Audiobook',
        price: 25,          // Retail price
        backer_price: 20,   // Kickstarter backer price
        weight: 0,
        description: 'MAYA: Seed Takes Root Audiobook narrated by Hugo Weaving',
        image: 'maya-audiobook.webp',
        active: 1
    },
    {
        name: 'MAYA Lorebook',
        price: 35,          // Retail price
        backer_price: 25,   // Kickstarter backer price
        weight: 600,
        description: 'MAYA Lore: Neh - Its Species and Their Cultures',
        image: 'maya-lorebook.png',
        active: 1
    },
    {
        name: 'Built Environments of MAYA Hardcover',
        price: 35,          // Retail price
        backer_price: 25,   // Kickstarter backer price
        weight: 800,
        description: 'Hardcover edition exploring the built environments of the MAYA universe',
        image: 'built-environments.png',
        active: 1
    },
    {
        name: 'Flitt Locust Pendant',
        price: 20,          // Retail price
        backer_price: 15,   // Kickstarter backer price
        weight: 50,
        description: 'Beautifully crafted Flitt Locust Pendant from the MAYA series',
        image: 'flitt-locust-pendant.png',
        active: 1
    },
    {
        name: 'MAYA: Seed Takes Root (Paperback)',
        price: 25,          // Retail price
        backer_price: 18,   // Kickstarter backer price
        weight: 400,
        description: 'MAYA: Seed Takes Root paperback edition',
        image: 'maya-paperback.png',
        active: 1
    },
    {
        name: 'MAYA: Seed Takes Root (Hardcover)',
        price: 50,          // Retail price
        backer_price: 35,   // Kickstarter backer price
        weight: 700,
        description: 'MAYA: Seed Takes Root hardcover edition',
        image: 'maya-hardcover.png',
        active: 1
    }
];

const isPostgres = !!process.env.DATABASE_URL;

// Normalize name for comparison
function normalizeName(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function runPostgres() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('✓ Connected to PostgreSQL database\n');

        // === PLEDGES ===
        console.log('='.repeat(60));
        console.log('📦 PLEDGES (products table)');
        console.log('='.repeat(60));

        // Check existing pledges
        const existingPledges = await pool.query('SELECT * FROM products WHERE type = $1', ['pledge']);
        console.log(`Found ${existingPledges.rows.length} existing pledge(s)\n`);

        for (const required of REQUIRED_PLEDGES) {
            const existing = existingPledges.rows.find(p => 
                normalizeName(p.name) === normalizeName(required.name)
            );

            if (existing) {
                // Check if prices match
                const priceMatch = parseFloat(existing.price) === required.price;
                const backerMatch = parseFloat(existing.backer_price) === required.backer_price;
                
                if (priceMatch && backerMatch) {
                    console.log(`✓ ${required.name}: $${required.backer_price}/$${required.price} (correct)`);
                } else {
                    // Update prices
                    await pool.query(
                        'UPDATE products SET price = $1, backer_price = $2 WHERE id = $3',
                        [required.price, required.backer_price, existing.id]
                    );
                    console.log(`🔄 ${required.name}: Updated to $${required.backer_price}/$${required.price}`);
                }
            } else {
                // Insert new pledge
                await pool.query(
                    `INSERT INTO products (name, price, backer_price, weight, type, description, image, active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [required.name, required.price, required.backer_price, required.weight, 
                     required.type, required.description, required.image, required.active]
                );
                console.log(`➕ ${required.name}: Added ($${required.backer_price}/$${required.price})`);
            }
        }

        // === ADD-ONS ===
        console.log('\n' + '='.repeat(60));
        console.log('🎁 ADD-ONS (addons table)');
        console.log('='.repeat(60));

        const existingAddons = await pool.query('SELECT * FROM addons');
        console.log(`Found ${existingAddons.rows.length} existing add-on(s)\n`);

        for (const required of REQUIRED_ADDONS) {
            const existing = existingAddons.rows.find(a => 
                normalizeName(a.name) === normalizeName(required.name)
            );

            if (existing) {
                const priceMatch = parseFloat(existing.price) === required.price;
                const backerMatch = parseFloat(existing.backer_price) === required.backer_price;
                
                if (priceMatch && backerMatch) {
                    console.log(`✓ ${required.name}: $${required.backer_price}/$${required.price} (correct)`);
                } else {
                    await pool.query(
                        'UPDATE addons SET price = $1, backer_price = $2 WHERE id = $3',
                        [required.price, required.backer_price, existing.id]
                    );
                    console.log(`🔄 ${required.name}: Updated to $${required.backer_price}/$${required.price}`);
                }
            } else {
                await pool.query(
                    `INSERT INTO addons (name, price, backer_price, weight, description, image, active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [required.name, required.price, required.backer_price, required.weight,
                     required.description, required.image, required.active]
                );
                console.log(`➕ ${required.name}: Added ($${required.backer_price}/$${required.price})`);
            }
        }

        await pool.end();
        console.log('\n✅ Verification complete!\n');

    } catch (err) {
        console.error('❌ Database error:', err.message);
        await pool.end();
        process.exit(1);
    }
}

function runSQLite() {
    const db = new sqlite3.Database('./database.db', (err) => {
        if (err) {
            console.error('❌ Error opening database:', err);
            process.exit(1);
        }
        console.log('✓ Connected to SQLite database\n');
    });

    // First, ensure tables have backer_price column
    db.run('ALTER TABLE products ADD COLUMN backer_price REAL', (err) => {
        // Ignore error if column exists
    });
    db.run('ALTER TABLE addons ADD COLUMN backer_price REAL', (err) => {
        // Ignore error if column exists
    });

    console.log('='.repeat(60));
    console.log('📦 PLEDGES (products table)');
    console.log('='.repeat(60));

    db.all('SELECT * FROM products WHERE type = ?', ['pledge'], (err, existingPledges) => {
        if (err) {
            console.log('  Note: products table may need initialization');
            existingPledges = [];
        }
        
        console.log(`Found ${(existingPledges || []).length} existing pledge(s)\n`);
        existingPledges = existingPledges || [];

        let pledgeOps = 0;
        REQUIRED_PLEDGES.forEach((required, idx) => {
            const existing = existingPledges.find(p => 
                normalizeName(p.name) === normalizeName(required.name)
            );

            if (existing) {
                const priceMatch = parseFloat(existing.price) === required.price;
                const backerMatch = parseFloat(existing.backer_price) === required.backer_price;
                
                if (priceMatch && backerMatch) {
                    console.log(`✓ ${required.name}: $${required.backer_price}/$${required.price} (correct)`);
                    pledgeOps++;
                    checkPledgesDone();
                } else {
                    db.run(
                        'UPDATE products SET price = ?, backer_price = ? WHERE id = ?',
                        [required.price, required.backer_price, existing.id],
                        (err) => {
                            if (err) {
                                console.log(`❌ Error updating ${required.name}:`, err.message);
                            } else {
                                console.log(`🔄 ${required.name}: Updated to $${required.backer_price}/$${required.price}`);
                            }
                            pledgeOps++;
                            checkPledgesDone();
                        }
                    );
                }
            } else {
                db.run(
                    `INSERT INTO products (name, price, backer_price, weight, type, description, image, active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [required.name, required.price, required.backer_price, required.weight,
                     required.type, required.description, required.image, required.active],
                    (err) => {
                        if (err) {
                            console.log(`❌ Error adding ${required.name}:`, err.message);
                        } else {
                            console.log(`➕ ${required.name}: Added ($${required.backer_price}/$${required.price})`);
                        }
                        pledgeOps++;
                        checkPledgesDone();
                    }
                );
            }
        });

        function checkPledgesDone() {
            if (pledgeOps >= REQUIRED_PLEDGES.length) {
                processAddons();
            }
        }
    });

    function processAddons() {
        console.log('\n' + '='.repeat(60));
        console.log('🎁 ADD-ONS (addons table)');
        console.log('='.repeat(60));

        db.all('SELECT * FROM addons', [], (err, existingAddons) => {
            if (err) {
                console.log('  Note: addons table may need initialization');
                existingAddons = [];
            }
            
            console.log(`Found ${(existingAddons || []).length} existing add-on(s)\n`);
            existingAddons = existingAddons || [];

            let addonOps = 0;
            REQUIRED_ADDONS.forEach((required, idx) => {
                const existing = existingAddons.find(a => 
                    normalizeName(a.name) === normalizeName(required.name)
                );

                if (existing) {
                    const priceMatch = parseFloat(existing.price) === required.price;
                    const backerMatch = parseFloat(existing.backer_price) === required.backer_price;
                    
                    if (priceMatch && backerMatch) {
                        console.log(`✓ ${required.name}: $${required.backer_price}/$${required.price} (correct)`);
                        addonOps++;
                        checkAddonsDone();
                    } else {
                        db.run(
                            'UPDATE addons SET price = ?, backer_price = ? WHERE id = ?',
                            [required.price, required.backer_price, existing.id],
                            (err) => {
                                if (err) {
                                    console.log(`❌ Error updating ${required.name}:`, err.message);
                                } else {
                                    console.log(`🔄 ${required.name}: Updated to $${required.backer_price}/$${required.price}`);
                                }
                                addonOps++;
                                checkAddonsDone();
                            }
                        );
                    }
                } else {
                    db.run(
                        `INSERT INTO addons (name, price, backer_price, weight, description, image, active)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [required.name, required.price, required.backer_price, required.weight,
                         required.description, required.image, required.active],
                        (err) => {
                            if (err) {
                                console.log(`❌ Error adding ${required.name}:`, err.message);
                            } else {
                                console.log(`➕ ${required.name}: Added ($${required.backer_price}/$${required.price})`);
                            }
                            addonOps++;
                            checkAddonsDone();
                        }
                    );
                }
            });

            function checkAddonsDone() {
                if (addonOps >= REQUIRED_ADDONS.length) {
                    setTimeout(() => {
                        db.close();
                        console.log('\n✅ Verification complete!\n');
                    }, 200);
                }
            }
        });
    }
}

// Run appropriate version
if (isPostgres) {
    console.log('📦 Using PostgreSQL\n');
    runPostgres();
} else {
    console.log('📦 Using SQLite\n');
    runSQLite();
}
