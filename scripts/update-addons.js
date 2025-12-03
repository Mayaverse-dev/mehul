require('dotenv').config();
const { Pool } = require('pg');

console.log('🔄 Updating add-ons in database...\n');

// New add-ons data
const addons = [
    {
        name: 'Flitt Locust Pendant',
        price: 20.00,
        weight: 50,
        description: 'Beautifully crafted Flitt Locust Pendant from the MAYA series',
        image: 'flitt-locust-pendant.png'
    },
    {
        name: 'MAYA: Seed Takes Root Audiobook',
        price: 25.00,
        weight: 0,
        description: 'MAYA: Seed Takes Root Audiobook narrated by Hugo Weaving',
        image: 'maya-audiobook.webp'
    },
    {
        name: 'Built Environments of MAYA Hardcover',
        price: 35.00,
        weight: 800,
        description: 'Hardcover edition exploring the built environments of the MAYA universe',
        image: 'built-environments.png'
    },
    {
        name: 'MAYA Lorebook',
        price: 35.00,
        weight: 600,
        description: 'MAYA Lore: Neh - Its Species and Their Cultures (Edition Zero)',
        image: 'maya-lorebook.png'
    }
];

async function updateAddons() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log('✓ Connected to database\n');

        // Clear old add-ons
        console.log('🗑️  Clearing old add-ons...');
        await pool.query('DELETE FROM addons');
        console.log('✓ Old add-ons cleared\n');

        // Insert new add-ons
        console.log('➕ Adding new add-ons...\n');
        for (const addon of addons) {
            await pool.query(
                `INSERT INTO addons (name, price, weight, description, image, active)
                 VALUES ($1, $2, $3, $4, $5, 1)`,
                [addon.name, addon.price, addon.weight, addon.description, addon.image]
            );
            console.log(`✓ Added: ${addon.name} ($${addon.price})`);
        }

        // Verify
        console.log('\n📋 Current add-ons in database:');
        const result = await pool.query('SELECT name, price FROM addons ORDER BY id');
        result.rows.forEach(row => {
            console.log(`   - ${row.name}: $${row.price}`);
        });

        console.log('\n✅ Successfully updated add-ons!\n');
        await pool.end();
    } catch (err) {
        console.error('❌ Error:', err.message);
        process.exit(1);
    }
}

updateAddons();

