require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function fixDatabase() {
    try {
        console.log('🔧 Fixing Railway database...\n');

        // 1. Create products table if it doesn't exist
        console.log('📋 Creating products table...');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                weight INTEGER DEFAULT 0,
                description TEXT,
                image VARCHAR(255),
                active INTEGER DEFAULT 1,
                type VARCHAR(50) DEFAULT 'addon',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✓ Products table ready\n');

        // 2. Clear addons table (has wrong data)
        console.log('🗑️  Clearing addons table...');
        await pool.query('DELETE FROM addons');
        console.log('✓ Addons cleared\n');

        // 3. Add correct add-ons
        console.log('➕ Adding add-ons...');
        const addons = [
            { name: 'Flitt Locust Pendant', price: 20.00, weight: 50, description: 'Beautifully crafted Flitt Locust Pendant', image: 'flitt-locust-pendant.png' },
            { name: 'MAYA: Seed Takes Root Audiobook', price: 25.00, weight: 0, description: 'Audiobook narrated by Hugo Weaving', image: 'maya-audiobook.webp' },
            { name: 'Built Environments of MAYA Hardcover', price: 35.00, weight: 800, description: 'Hardcover edition exploring built environments', image: 'built-environments.png' },
            { name: 'MAYA Lorebook', price: 35.00, weight: 600, description: 'MAYA Lore: Neh - Its Species and Their Cultures', image: 'maya-lorebook.png' }
        ];

        for (const addon of addons) {
            await pool.query(
                'INSERT INTO addons (name, price, weight, description, image, active) VALUES ($1, $2, $3, $4, $5, 1)',
                [addon.name, addon.price, addon.weight, addon.description, addon.image]
            );
            console.log(`  ✓ ${addon.name}`);
        }

        // 4. Add pledges to products table
        console.log('\n➕ Adding pledge tiers...');
        const pledges = [
            { name: 'The Humble Vaanar', price: 25.00, description: 'Entry-level pledge', image: 'humble-vaanar.png', weight: 400 },
            { name: 'The Industrious Manushya', price: 50.00, description: 'Mid-tier pledge', image: 'industrious-manushya.png', weight: 500 },
            { name: 'The Resplendent Garuda', price: 150.00, description: 'Popular pledge tier', image: 'resplendant-garuda.png', weight: 800 },
            { name: 'The Benevolent Divya', price: 190.00, description: 'High-tier pledge', image: 'benevolent-divya.png', weight: 1000 },
            { name: 'Founders of Neh', price: 2000.00, description: 'Exclusive Founders tier', image: 'founders-of-neh.png', weight: 1500 }
        ];

        for (const pledge of pledges) {
            await pool.query(
                'INSERT INTO products (name, price, weight, description, image, active, type) VALUES ($1, $2, $3, $4, $5, 1, $6)',
                [pledge.name, pledge.price, pledge.weight, pledge.description, pledge.image, 'pledge']
            );
            console.log(`  ✓ ${pledge.name}`);
        }

        console.log('\n✅ Database fixed successfully!\n');
        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error);
        await pool.end();
        process.exit(1);
    }
}

fixDatabase();

