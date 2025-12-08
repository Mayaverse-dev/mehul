require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// The 4 original addons
const originalAddons = [
    {
        name: 'Flitt Locust Pendant',
        price: 20.00,
        weight: 50,
        description: 'Beautifully crafted Flitt Locust Pendant from the MAYA series',
        image: 'flitt-locust-pendant.png',
        active: 1
    },
    {
        name: 'MAYA: Seed Takes Root Audiobook',
        price: 25.00,
        weight: 0,
        description: 'MAYA: Seed Takes Root Audiobook narrated by Hugo Weaving',
        image: 'maya-audiobook.webp',
        active: 1
    },
    {
        name: 'Built Environments of MAYA Hardcover',
        price: 35.00,
        weight: 800,
        description: 'Hardcover edition exploring the built environments of the MAYA universe',
        image: 'built-environments.png',
        active: 1
    },
    {
        name: 'MAYA Lorebook',
        price: 35.00,
        weight: 600,
        description: 'MAYA Lore: Neh - Its Species and Their Cultures (Edition Zero)',
        image: 'maya-lorebook.png',
        active: 1
    }
];

async function cleanupAddons() {
    try {
        console.log('🧹 Cleaning up addons table...\n');

        // 1. Get current addons
        const currentAddons = await pool.query('SELECT * FROM addons ORDER BY id');
        console.log(`Found ${currentAddons.rows.length} addons in database\n`);

        // 2. Delete all addons
        console.log('🗑️  Deleting all existing addons...');
        await pool.query('DELETE FROM addons');
        console.log('✓ All addons deleted\n');

        // 3. Insert only the 4 original addons
        console.log('➕ Inserting 4 original addons...');
        for (const addon of originalAddons) {
            await pool.query(
                `INSERT INTO addons (name, price, weight, description, image, active) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [addon.name, addon.price, addon.weight, addon.description, addon.image, addon.active]
            );
            console.log(`  ✓ ${addon.name} - $${addon.price}`);
        }

        // 4. Verify
        const finalAddons = await pool.query('SELECT * FROM addons ORDER BY id');
        console.log(`\n✅ Cleanup complete! ${finalAddons.rows.length} addons in database:`);
        finalAddons.rows.forEach(row => {
            console.log(`  - ${row.name} (ID: ${row.id}, Price: $${row.price})`);
        });

        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error);
        await pool.end();
        process.exit(1);
    }
}

cleanupAddons();

