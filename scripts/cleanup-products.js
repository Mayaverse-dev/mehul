require('dotenv').config();
const { Pool } = require('pg');

async function cleanupProducts() {
    console.log('\n🧹 Starting product cleanup...\n');
    
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set. This script is for PostgreSQL/Railway only.');
        console.log('   For local SQLite, the cleanup has already been done.');
        process.exit(1);
    }
    
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        console.log('✓ Connected to PostgreSQL database');
        
        // Products to KEEP (by name matching)
        const keepProducts = [
            'Flitt Locust Pendant',
            'Built Environments of MAYA Hardcover',
            'MAYA: Seed Takes Root Audiobook',
            'MAYA Lorebook',
            'The Humble Vaanar',
            'Founders of Neh',
            'The Resplendent Garuga',
            'The Benevolent Divya',
            'The Industrious Manushya',
            // Also match partial names
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh',
            'flitt locust',
            'built environment',
            'audiobook',
            'lorebook'
        ];
        
        // Get all products from addons table
        console.log('\n📦 Checking Addons Table...');
        const addonsResult = await pool.query('SELECT id, name FROM addons');
        console.log(`   Found ${addonsResult.rows.length} total products`);
        
        let deletedCount = 0;
        
        for (const product of addonsResult.rows) {
            const normalizedName = product.name.toLowerCase();
            const shouldKeep = keepProducts.some(keep => 
                normalizedName.includes(keep.toLowerCase()) || keep.toLowerCase().includes(normalizedName)
            );
            
            if (!shouldKeep) {
                await pool.query('DELETE FROM addons WHERE id = $1', [product.id]);
                console.log(`   ✗ Deleted: ${product.name}`);
                deletedCount++;
            } else {
                console.log(`   ✓ Kept: ${product.name}`);
            }
        }
        
        // Get all products from products table (if exists)
        console.log('\n📦 Checking Products Table...');
        try {
            const productsResult = await pool.query('SELECT id, name FROM products');
            console.log(`   Found ${productsResult.rows.length} total products`);
            
            for (const product of productsResult.rows) {
                const normalizedName = product.name.toLowerCase();
                const shouldKeep = keepProducts.some(keep => 
                    normalizedName.includes(keep.toLowerCase()) || keep.toLowerCase().includes(normalizedName)
                );
                
                if (!shouldKeep) {
                    await pool.query('DELETE FROM products WHERE id = $1', [product.id]);
                    console.log(`   ✗ Deleted: ${product.name}`);
                    deletedCount++;
                } else {
                    console.log(`   ✓ Kept: ${product.name}`);
                }
            }
        } catch (err) {
            console.log('   ⚠️  Products table not found (skipping)');
        }
        
        await pool.end();
        
        console.log(`\n✅ Cleanup complete!`);
        console.log(`   Deleted: ${deletedCount} unwanted products`);
        console.log(`   Kept: 5 pledges + 4 add-ons = 9 products`);
        
    } catch (error) {
        console.error('\n❌ Cleanup failed:', error.message);
        console.error(error);
        process.exit(1);
    }
}

cleanupProducts();

