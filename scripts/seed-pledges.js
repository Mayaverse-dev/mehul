require('dotenv').config();
const { Pool } = require('pg');

console.log('🌱 Setting up Kickstarter pledge tiers...\n');

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
        image: 'resplendent-garuda.png',
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

async function setupPledges() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('✓ Connected to database\n');

        // Clear existing products (keep only add-ons if needed, or clear all)
        console.log('🗑️  Clearing old products...');
        await pool.query('DELETE FROM addons');
        console.log('✓ Products cleared\n');

        // Insert pledge tiers
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
        console.log('\n📋 Current pledge tiers:');
        const result = await pool.query('SELECT name, price FROM addons ORDER BY price');
        result.rows.forEach(row => {
            console.log(`   - ${row.name}: $${row.price}`);
        });

        console.log('\n✅ Successfully set up pledge tiers!\n');
        await pool.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

setupPledges();

