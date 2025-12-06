/**
 * Check orders ready for autodebit in PostgreSQL
 */

require('dotenv').config();
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:CWSStsWgSVfrIkNPcXkyuvMNkInfewWR@shortline.proxy.rlwy.net:47402/railway';

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
});

async function checkOrders() {
    try {
        console.log('\n=== Checking Orders Ready for Autodebit ===\n');
        
        // Get orders with saved cards
        const orders = await pool.query(`
            SELECT 
                id,
                user_id,
                total,
                stripe_customer_id,
                stripe_payment_method_id,
                stripe_payment_intent_id,
                payment_status,
                paid,
                shipping_address,
                created_at
            FROM orders 
            WHERE payment_status = 'card_saved' 
            AND paid = 0 
            AND stripe_customer_id IS NOT NULL 
            AND stripe_payment_method_id IS NOT NULL
            ORDER BY id DESC
        `);

        if (orders.rows.length === 0) {
            console.log('✓ No orders found with saved cards ready to charge');
            console.log('\nTo test autodebit:');
            console.log('1. Complete a checkout flow to save a card');
            console.log('2. Verify order has payment_status = "card_saved"');
            console.log('3. Run bulk charge from admin dashboard');
        } else {
            console.log(`Found ${orders.rows.length} order(s) ready for charging:\n`);
            
            let totalAmount = 0;
            orders.rows.forEach((order, index) => {
                const address = JSON.parse(order.shipping_address || '{}');
                totalAmount += parseFloat(order.total || 0);
                
                console.log(`[${index + 1}] Order #${order.id}`);
                console.log(`    Amount: $${order.total}`);
                console.log(`    Customer: ${order.stripe_customer_id}`);
                console.log(`    Payment Method: ${order.stripe_payment_method_id}`);
                console.log(`    Payment Intent: ${order.stripe_payment_intent_id || 'N/A'}`);
                console.log(`    Email: ${address.email || 'N/A'}`);
                console.log(`    Status: ${order.payment_status}`);
                console.log(`    Created: ${order.created_at}`);
                console.log('');
            });

            console.log(`Total to charge: $${totalAmount.toFixed(2)}`);
            console.log(`\nTo charge these orders:`);
            console.log('1. Login to admin dashboard: /admin/login');
            console.log('2. Click "Bulk Charge All" button');
            console.log('3. Or use API: POST /api/admin/bulk-charge-orders');
        }

        // Also check all orders summary
        const allOrders = await pool.query('SELECT payment_status, paid, COUNT(*) as count FROM orders GROUP BY payment_status, paid ORDER BY payment_status, paid');
        console.log('\n📊 Order Status Summary:');
        allOrders.rows.forEach(row => {
            console.log(`   ${row.payment_status} (paid: ${row.paid}): ${row.count} orders`);
        });

        await pool.end();
    } catch (err) {
        console.error('✗ Error:', err.message);
        await pool.end();
        process.exit(1);
    }
}

checkOrders();

