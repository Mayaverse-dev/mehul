/**
 * Test script for bulk charge functionality
 * 
 * This script helps test the autodebit/bulk charge feature.
 * It checks for orders with saved cards and shows what would be charged.
 * 
 * Usage: node scripts/test-bulk-charge.js
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Database connection
const dbPath = path.join(__dirname, '..', 'database.db');
const db = new sqlite3.Database(dbPath);

console.log('\n=== BULK CHARGE TEST ===\n');

// Check orders ready for charging
db.all(`
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
`, [], (err, orders) => {
    if (err) {
        console.error('✗ Database error:', err);
        db.close();
        process.exit(1);
    }

    if (orders.length === 0) {
        console.log('✓ No orders found with saved cards ready to charge');
        console.log('\nTo test bulk charge:');
        console.log('1. Complete a checkout flow to save a card');
        console.log('2. Verify order has payment_status = "card_saved"');
        console.log('3. Run this script again or use admin dashboard');
        db.close();
        return;
    }

    console.log(`Found ${orders.length} order(s) ready for charging:\n`);

    let totalAmount = 0;
    orders.forEach((order, index) => {
        const address = JSON.parse(order.shipping_address || '{}');
        totalAmount += order.total;
        
        console.log(`[${index + 1}] Order #${order.id}`);
        console.log(`    Amount: $${order.total.toFixed(2)}`);
        console.log(`    Customer: ${order.stripe_customer_id}`);
        console.log(`    Payment Method: ${order.stripe_payment_method_id}`);
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
    console.log('\n⚠️  Make sure Stripe keys are configured in .env');

    db.close();
});

