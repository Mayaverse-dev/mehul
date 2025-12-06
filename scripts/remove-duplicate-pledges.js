/**
 * Remove duplicate pledges from addons table
 * Keep pledges in products table (Mehul's original setup)
 * Remove pledges from addons table (duplicates I accidentally added)
 */

require('dotenv').config();
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:CWSStsWgSVfrIkNPcXkyuvMNkInfewWR@shortline.proxy.rlwy.net:47402/railway';

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
});

async function removeDuplicates() {
    try {
        console.log('🔍 Checking for duplicate pledges in addons table...\n');
        
        // Pledge names to remove from addons (they should only be in products table)
        const pledgeNames = [
            'The Humble Vaanar',
            'The Industrious Manushya',
            'The Resplendent Garuda',
            'The Benevolent Divya',
            'Founders of Neh'
        ];
        
        // Check what's in addons
        const checkResult = await pool.query(`
            SELECT id, name, price 
            FROM addons 
            WHERE name = ANY($1::text[])
            ORDER BY name
        `, [pledgeNames]);
        
        if (checkResult.rows.length === 0) {
            console.log('✓ No duplicate pledges found in addons table');
            console.log('  Database is clean - pledges only in products table');
            await pool.end();
            return;
        }
        
        console.log(`Found ${checkResult.rows.length} duplicate pledge(s) in addons table:`);
        checkResult.rows.forEach(row => {
            console.log(`   - ${row.name} (ID: ${row.id}, $${row.price})`);
        });
        
        console.log('\n🗑️  Removing duplicates from addons table...');
        
        // Delete pledges from addons table
        const deleteResult = await pool.query(`
            DELETE FROM addons 
            WHERE name = ANY($1::text[])
        `, [pledgeNames]);
        
        console.log(`✓ Removed ${deleteResult.rowCount} duplicate pledge(s) from addons table`);
        
        // Verify products table still has pledges
        const productsCheck = await pool.query(`
            SELECT name, price 
            FROM products 
            WHERE type = 'pledge' 
            ORDER BY price
        `);
        
        console.log(`\n✓ Products table has ${productsCheck.rows.length} pledge(s):`);
        productsCheck.rows.forEach(row => {
            console.log(`   - ${row.name}: $${row.price}`);
        });
        
        // Verify addons table now only has add-ons
        const addonsCheck = await pool.query(`
            SELECT COUNT(*) as total 
            FROM addons
        `);
        console.log(`\n✓ Addons table now has ${addonsCheck.rows[0].total} add-on(s) only`);
        
        await pool.end();
        console.log('\n✅ Database cleaned - duplicates removed!');
    } catch (err) {
        console.error('❌ Error:', err.message);
        await pool.end();
        process.exit(1);
    }
}

removeDuplicates();

