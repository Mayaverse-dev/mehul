/**
 * Check what's in the PostgreSQL database
 */

require('dotenv').config();
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:CWSStsWgSVfrIkNPcXkyuvMNkInfewWR@shortline.proxy.rlwy.net:47402/railway';

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
});

async function checkDatabase() {
    try {
        console.log('🔍 Checking PostgreSQL database...\n');
        console.log('Database URL:', databaseUrl.replace(/:[^:@]+@/, ':****@')); // Hide password
        console.log('');

        // Check tables
        console.log('📋 Tables in database:');
        const tablesResult = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        tablesResult.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });
        console.log('');

        // Check if products table exists
        const productsTableExists = tablesResult.rows.some(r => r.table_name === 'products');
        
        // Check addons table
        console.log('📦 Addons table contents:');
        const addonsResult = await pool.query('SELECT COUNT(*) as total FROM addons');
        console.log(`   Total addons: ${addonsResult.rows[0].total}`);
        
        const addons = await pool.query('SELECT name, price, active FROM addons ORDER BY price LIMIT 20');
        console.log(`   Showing first ${addons.rows.length} addons:`);
        addons.rows.forEach(row => {
            console.log(`   - ${row.name}: $${row.price} (active: ${row.active})`);
        });
        console.log('');

        // Check for pledges in addons
        console.log('🎁 Checking for pledge tiers in addons:');
        const pledgeNames = ['humble vaanar', 'industrious manushya', 'resplendent garuda', 'benevolent divya', 'founders of neh'];
        const pledgesResult = await pool.query(`
            SELECT name, price, active 
            FROM addons 
            WHERE LOWER(name) LIKE ANY(ARRAY[${pledgeNames.map(n => `'%${n}%'`).join(', ')}])
            ORDER BY price
        `);
        
        if (pledgesResult.rows.length > 0) {
            console.log(`   Found ${pledgesResult.rows.length} pledge(s):`);
            pledgesResult.rows.forEach(row => {
                console.log(`   ✓ ${row.name}: $${row.price}`);
            });
        } else {
            console.log('   ⚠ No pledges found in addons table');
        }
        console.log('');

        // Check products table if it exists
        if (productsTableExists) {
            console.log('📦 Products table contents:');
            const productsResult = await pool.query('SELECT COUNT(*) as total FROM products');
            console.log(`   Total products: ${productsResult.rows[0].total}`);
            
            const products = await pool.query('SELECT name, price, type, active FROM products ORDER BY price LIMIT 20');
            if (products.rows.length > 0) {
                console.log(`   Showing first ${products.rows.length} products:`);
                products.rows.forEach(row => {
                    console.log(`   - ${row.name}: $${row.price} (type: ${row.type}, active: ${row.active})`);
                });
            } else {
                console.log('   (empty)');
            }
            console.log('');

            // Check for pledges in products
            const productsPledges = await pool.query("SELECT name, price FROM products WHERE type = 'pledge' ORDER BY price");
            if (productsPledges.rows.length > 0) {
                console.log(`   Found ${productsPledges.rows.length} pledge(s) in products table:`);
                productsPledges.rows.forEach(row => {
                    console.log(`   ✓ ${row.name}: $${row.price}`);
                });
            }
            console.log('');
        } else {
            console.log('⚠ Products table does not exist\n');
        }

        // Check orders
        console.log('📋 Orders table:');
        const ordersResult = await pool.query('SELECT COUNT(*) as total FROM orders');
        console.log(`   Total orders: ${ordersResult.rows[0].total}`);
        
        const ordersWithCards = await pool.query(`
            SELECT COUNT(*) as total 
            FROM orders 
            WHERE payment_status = 'card_saved' 
            AND paid = 0 
            AND stripe_payment_method_id IS NOT NULL
        `);
        console.log(`   Orders ready for autodebit: ${ordersWithCards.rows[0].total}`);
        console.log('');

        // Check users
        console.log('👥 Users table:');
        const usersResult = await pool.query('SELECT COUNT(*) as total FROM users');
        console.log(`   Total users: ${usersResult.rows[0].total}`);
        console.log('');

        await pool.end();
        console.log('✅ Database check complete!');
    } catch (err) {
        console.error('❌ Error:', err.message);
        console.error('   Stack:', err.stack);
        await pool.end();
        process.exit(1);
    }
}

checkDatabase();

