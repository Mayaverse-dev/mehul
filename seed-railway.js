const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const addons = [
    ['MAYA Bookmark', 15.00, 20, 'Beautiful MAYA bookmarks featuring stunning artwork from the series', 'maya-bookmark.png', 1],
    ['MAYA Sticker', 10.00, 10, 'Premium vinyl stickers featuring characters from MAYA', 'maya-sticker.png', 1],
    ['MAYA Poster', 25.00, 150, 'High-quality art poster featuring the world of MAYA', 'maya-poster.png', 1],
    ['MAYA Notebook', 20.00, 300, 'Premium notebook with MAYA artwork cover', 'maya-notebook.png', 1],
    ['MAYA Patches', 12.00, 25, 'Embroidered patches featuring MAYA characters and symbols', 'maya-patches.png', 1],
    ['MAYA Enamel Pin', 18.00, 30, 'High-quality enamel pins with intricate MAYA designs', 'maya-enamel-pin.png', 1]
];

async function seed() {
    console.log('🌱 Seeding Railway PostgreSQL database...\n');
    
    try {
        for (const addon of addons) {
            await pool.query(
                'INSERT INTO addons (name, price, weight, description, image, active) VALUES ($1, $2, $3, $4, $5, $6)',
                addon
            );
            console.log(`✓ Added: ${addon[0]} ($${addon[1]})`);
        }
        
        console.log('\n✅ Successfully seeded all add-ons!');
        await pool.end();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

seed();

