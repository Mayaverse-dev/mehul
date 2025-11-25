require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();

console.log('🌱 Seeding add-ons...\n');

// Connect to database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Error opening database:', err);
        process.exit(1);
    }
    console.log('✓ Connected to database\n');
});

// Sample add-ons (adjust these based on your actual products)
const addons = [
    {
        name: 'Flitt Locust Pendant',
        kickstarter_addon_id: '10750435',
        price: 35.00,
        weight: 50,
        description: 'Beautifully crafted pendant featuring the iconic Flitt Locust from MAYA',
        active: 1
    },
    {
        name: 'MAYA: Seed Takes Root Audiobook',
        kickstarter_addon_id: '10750413',
        price: 20.00,
        weight: 0,
        description: 'Narrated by Hugo Weaving. Digital audiobook access.',
        active: 1
    },
    {
        name: 'Built Environments of MAYA Hardcover',
        kickstarter_addon_id: '10753939',
        price: 45.00,
        weight: 600,
        description: 'Explore the architectural wonders and environments of the MAYA universe',
        active: 1
    },
    {
        name: 'MAYA Lorebook',
        kickstarter_addon_id: '10753941',
        price: 30.00,
        weight: 400,
        description: 'Deep dive into the species, cultures, and lore of MAYA',
        active: 1
    },
    {
        name: 'MAYA Art Prints Set',
        price: 25.00,
        weight: 200,
        description: 'Set of 5 premium quality art prints featuring scenes from MAYA',
        active: 1
    },
    {
        name: 'MAYA Poster (Large)',
        price: 15.00,
        weight: 150,
        description: '24" x 36" poster featuring stunning MAYA artwork',
        active: 1
    },
    {
        name: 'MAYA Keychain',
        price: 12.00,
        weight: 30,
        description: 'Metal keychain with MAYA logo and Flitt Locust design',
        active: 1
    },
    {
        name: 'MAYA Sticker Pack',
        price: 8.00,
        weight: 20,
        description: 'Pack of 10 vinyl stickers featuring characters and symbols from MAYA',
        active: 1
    }
];

// Insert add-ons
let insertedCount = 0;

addons.forEach((addon, index) => {
    db.run(`INSERT INTO addons (
        name, kickstarter_addon_id, price, weight, description, active
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
        addon.name,
        addon.kickstarter_addon_id || null,
        addon.price,
        addon.weight,
        addon.description,
        addon.active
    ],
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
    });
});







