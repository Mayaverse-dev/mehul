require('dotenv').config();
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();

console.log('🌱 Seeding add-ons...\n');

// Determine which database to use
const isPostgres = !!process.env.DATABASE_URL;

// Add-ons data
const addons = [
    {
        name: 'Flitt Locust Pendant',
        price: 20.00,
        weight: 50,
        description: 'Beautifully crafted Flitt Locust Pendant from the MAYA series',
        image: 'flitt-locust-pendant.jpg',
        active: 1
    },
    {
        name: 'MAYA: Seed Takes Root Audiobook',
        price: 25.00,
        weight: 0,
        description: 'MAYA: Seed Takes Root Audiobook narrated by Hugo Weaving',
        image: 'maya-audiobook.jpg',
        active: 1
    },
    {
        name: 'Built Environments of MAYA Hardcover',
        price: 35.00,
        weight: 800,
        description: 'Hardcover edition exploring the built environments of the MAYA universe',
        image: 'built-environments.jpg',
        active: 1
    },
    {
        name: 'MAYA Lorebook',
        price: 35.00,
        weight: 600,
        description: 'MAYA Lore: Neh - Its Species and Their Cultures (Edition Zero)',
        image: 'maya-lorebook.jpg',
        active: 1
    }
];

async function seedPostgres() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        console.log('✓ Connected to PostgreSQL database\n');

        for (const addon of addons) {
            try {
                await pool.query(
                    `INSERT INTO addons (name, price, weight, description, image, active)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [addon.name, addon.price, addon.weight, addon.description, addon.image, addon.active]
                );
                console.log(`✓ Added: ${addon.name} ($${addon.price})`);
            } catch (err) {
                console.error(`❌ Error inserting "${addon.name}":`, err.message);
            }
        }

        console.log(`\n✅ Successfully seeded ${addons.length} add-ons!\n`);
        await pool.end();
    } catch (err) {
        console.error('❌ Database error:', err);
        process.exit(1);
    }
}

function seedSQLite() {
    const db = new sqlite3.Database('./database.db', (err) => {
        if (err) {
            console.error('❌ Error opening database:', err);
            process.exit(1);
        }
        console.log('✓ Connected to SQLite database\n');
    });

    let insertedCount = 0;

    addons.forEach((addon, index) => {
        db.run(
            `INSERT INTO addons (name, price, weight, description, image, active)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [addon.name, addon.price, addon.weight, addon.description, addon.image, addon.active],
            (err) => {
                if (err) {
                    console.error(`❌ Error inserting "${addon.name}":`, err.message);
                } else {
                    insertedCount++;
                    console.log(`✓ Added: ${addon.name} ($${addon.price})`);
                }

                // Close database after last insert
                if (index === addons.length - 1) {
                    setTimeout(() => {
                        console.log(`\n✅ Successfully seeded ${insertedCount} add-ons!\n`);
                        db.close();
                    }, 100);
                }
            }
        );
    });
}

// Run the appropriate seeder
if (isPostgres) {
    console.log('📦 Using PostgreSQL\n');
    seedPostgres();
} else {
    console.log('📦 Using SQLite\n');
    seedSQLite();
}
