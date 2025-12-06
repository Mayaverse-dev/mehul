/**
 * Seed pledge tiers into PostgreSQL database (Railway)
 * This script adds the 5 pledge tiers to the addons table
 */

require('dotenv').config();
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set.');
    console.error('Please set it in your .env file or export it.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
});

console.log('🌱 Seeding pledge tiers into PostgreSQL (Railway)...\n');

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

async function seedPledges() {
    try {
        console.log('✓ Connected to PostgreSQL database\n');

        // Check if pledges already exist
        const checkResult = await pool.query(
            `SELECT name FROM addons 
             WHERE name LIKE '%Benevolent%' 
                OR name LIKE '%Vaanar%' 
                OR name LIKE '%Garuda%' 
                OR name LIKE '%Manushya%' 
                OR name LIKE '%Founders%'`
        );

        if (checkResult.rows.length > 0) {
            console.log(`⚠ Found ${checkResult.rows.length} existing pledge(s) in database:`);
            checkResult.rows.forEach(p => console.log(`   - ${p.name}`));
            console.log('\nDo you want to continue? (This will add duplicates)');
            console.log('Skipping seed to avoid duplicates...\n');
            await pool.end();
            return;
        }

        console.log('➕ Adding pledge tiers...\n');
        
        for (const pledge of pledges) {
            await pool.query(
                `INSERT INTO addons (name, price, weight, description, image, active)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [pledge.name, pledge.price, pledge.weight, pledge.description, pledge.image, pledge.active]
            );
            console.log(`✓ Added: ${pledge.name} ($${pledge.price})`);
        }

        // Verify
        console.log('\n📋 Verifying pledge tiers...');
        const verifyResult = await pool.query(
            `SELECT name, price FROM addons 
             WHERE name LIKE '%Benevolent%' 
                OR name LIKE '%Vaanar%' 
                OR name LIKE '%Garuda%' 
                OR name LIKE '%Manushya%' 
                OR name LIKE '%Founders%'
             ORDER BY price`
        );
        
        verifyResult.rows.forEach(row => {
            console.log(`   - ${row.name}: $${row.price}`);
        });

        console.log('\n✅ Successfully seeded pledge tiers!\n');
        await pool.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error('   Stack:', err.stack);
        await pool.end();
        process.exit(1);
    }
}

seedPledges();

