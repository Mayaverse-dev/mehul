require('dotenv').config();
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();

// Backer prices mapping
const BACKER_PRICES = {
    // Pledges
    'The Humble Vaanar': 18,
    'The Industrious Manushya': 35,
    'The Resplendent Garuda': 99,
    'The Benevolent Divya': 150,
    'Founders of Neh': 1500,
    
    // Add-ons
    'Built Environments of MAYA Hardcover': 25,
    'MAYA Lorebook': 25,
    'Flitt Locust Pendant': 15,
    'MAYA: Seed Takes Root Audiobook': 20
};

// Normalize product names for matching (case-insensitive, ignore extra spaces)
function normalizeProductName(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Check if a product name matches any of our backer price keys
function findBackerPrice(productName) {
    const normalized = normalizeProductName(productName);
    
    for (const [key, price] of Object.entries(BACKER_PRICES)) {
        if (normalizeProductName(key) === normalized) {
            return price;
        }
    }
    
    return null;
}

async function updateBackerPrices() {
    console.log('\n🔄 Starting backer price migration...\n');
    
    let pool = null;
    let db = null;
    const isPostgres = !!process.env.DATABASE_URL;
    
    try {
        if (isPostgres) {
            // PostgreSQL connection
            pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
            
            console.log('✓ Connected to PostgreSQL database');
            
            // Update products table (pledges)
            console.log('\n📦 Updating Products Table (Pledges)...');
            const productsResult = await pool.query('SELECT id, name, price FROM products WHERE active = 1');
            
            for (const product of productsResult.rows) {
                const backerPrice = findBackerPrice(product.name);
                
                if (backerPrice !== null) {
                    await pool.query(
                        'UPDATE products SET backer_price = $1 WHERE id = $2',
                        [backerPrice, product.id]
                    );
                    console.log(`  ✓ ${product.name}: $${product.price} → $${backerPrice} (backer)`);
                } else {
                    console.log(`  ⚠️  ${product.name}: No backer price defined (keeping retail only)`);
                }
            }
            
            // Update addons table
            console.log('\n🎁 Updating Addons Table...');
            const addonsResult = await pool.query('SELECT id, name, price FROM addons WHERE active = 1');
            
            for (const addon of addonsResult.rows) {
                const backerPrice = findBackerPrice(addon.name);
                
                if (backerPrice !== null) {
                    await pool.query(
                        'UPDATE addons SET backer_price = $1 WHERE id = $2',
                        [backerPrice, addon.id]
                    );
                    console.log(`  ✓ ${addon.name}: $${addon.price} → $${backerPrice} (backer)`);
                } else {
                    console.log(`  ⚠️  ${addon.name}: No backer price defined (keeping retail only)`);
                }
            }
            
            await pool.end();
            
        } else {
            // SQLite connection (local development)
            db = new sqlite3.Database('./database.db');
            console.log('✓ Connected to SQLite database');
            
            // Update products table (if exists)
            console.log('\n📦 Updating Products Table (Pledges)...');
            db.all('SELECT id, name, price FROM products WHERE active = 1', [], (err, products) => {
                if (err) {
                    console.log('  ⚠️  Products table not available:', err.message);
                } else {
                    products.forEach(product => {
                        const backerPrice = findBackerPrice(product.name);
                        
                        if (backerPrice !== null) {
                            db.run(
                                'UPDATE products SET backer_price = ? WHERE id = ?',
                                [backerPrice, product.id],
                                (err) => {
                                    if (err) {
                                        console.log(`  ✗ Error updating ${product.name}:`, err.message);
                                    } else {
                                        console.log(`  ✓ ${product.name}: $${product.price} → $${backerPrice} (backer)`);
                                    }
                                }
                            );
                        } else {
                            console.log(`  ⚠️  ${product.name}: No backer price defined (keeping retail only)`);
                        }
                    });
                }
            });
            
            // Update addons table
            console.log('\n🎁 Updating Addons Table...');
            db.all('SELECT id, name, price FROM addons WHERE active = 1', [], (err, addons) => {
                if (err) {
                    console.log('  ✗ Error fetching addons:', err.message);
                } else {
                    addons.forEach(addon => {
                        const backerPrice = findBackerPrice(addon.name);
                        
                        if (backerPrice !== null) {
                            db.run(
                                'UPDATE addons SET backer_price = ? WHERE id = ?',
                                [backerPrice, addon.id],
                                (err) => {
                                    if (err) {
                                        console.log(`  ✗ Error updating ${addon.name}:`, err.message);
                                    } else {
                                        console.log(`  ✓ ${addon.name}: $${addon.price} → $${backerPrice} (backer)`);
                                    }
                                }
                            );
                        } else {
                            console.log(`  ⚠️  ${addon.name}: No backer price defined (keeping retail only)`);
                        }
                    });
                }
                
                // Close database after a delay to allow updates to complete
                setTimeout(() => {
                    db.close();
                    console.log('\n✅ Migration complete!\n');
                }, 1000);
            });
        }
        
        if (isPostgres) {
            console.log('\n✅ Migration complete!\n');
        }
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// Run migration
updateBackerPrices();

