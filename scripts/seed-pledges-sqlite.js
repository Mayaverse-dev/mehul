/**
 * Seed pledge tiers into SQLite database (addons table)
 * This script adds the 5 pledge tiers to the addons table
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

console.log('🌱 Seeding pledge tiers into addons table...\n');

// Kickstarter pledge tiers
const pledges = [
    {
        name: 'The Humble Vaanar',
        price: 25.00,
        weight: 400,
        description: 'Entry-level pledge tier with the complete MAYA experience',
        image: 'humble-vaanar.png',
        active: 1
    },
    {
        name: 'The Industrious Manushya',
        price: 50.00,
        weight: 500,
        description: 'Standard pledge tier with enhanced collectibles',
        image: 'industrious-manushya.png',
        active: 1
    },
    {
        name: 'The Resplendent Garuda',
        price: 150.00,
        weight: 800,
        description: 'Premium pledge tier with exclusive items',
        image: 'resplendant-garuda.png',
        active: 1
    },
    {
        name: 'The Benevolent Divya',
        price: 190.00,
        weight: 1000,
        description: 'Deluxe pledge tier with rare collectibles',
        image: 'benevolent-divya.png',
        active: 1
    },
    {
        name: 'Founders of Neh',
        price: 2000.00,
        weight: 1500,
        description: 'Ultimate founder tier with all exclusive benefits',
        image: 'founders-of-neh.png',
        active: 1
    }
];

// Check if pledges already exist
db.all("SELECT name FROM addons WHERE name LIKE '%Benevolent%' OR name LIKE '%Vaanar%' OR name LIKE '%Garuda%' OR name LIKE '%Manushya%' OR name LIKE '%Founders%'", [], (err, existing) => {
    if (err) {
        console.error('✗ Error checking existing pledges:', err);
        db.close();
        process.exit(1);
    }

    if (existing && existing.length > 0) {
        console.log(`⚠ Found ${existing.length} existing pledge(s) in database:`);
        existing.forEach(p => console.log(`   - ${p.name}`));
        console.log('\nSkipping seed (pledges already exist)');
        db.close();
        return;
    }

    console.log('➕ Adding pledge tiers...\n');
    
    let completed = 0;
    pledges.forEach((pledge, index) => {
        db.run(
            `INSERT INTO addons (name, price, weight, description, image, active)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [pledge.name, pledge.price, pledge.weight, pledge.description, pledge.image, pledge.active],
            function(err) {
                if (err) {
                    console.error(`✗ Error adding ${pledge.name}:`, err.message);
                } else {
                    console.log(`✓ Added: ${pledge.name} ($${pledge.price})`);
                }
                
                completed++;
                if (completed === pledges.length) {
                    console.log('\n✅ Successfully seeded pledge tiers!\n');
                    db.close();
                }
            }
        );
    });
});

