#!/usr/bin/env node
/**
 * Batch Validate Order Zero Users
 * 
 * Runs the same checks as validate-real-user.test.js for all 96 rows
 * processed by import-order-zero.js
 */

if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/maya_db';
}

const XLSX = require('xlsx');
const { initConnection, closeConnections, query, queryOne } = require('../config/database');

const VALID_TIERS = [
    'Humble Vaanar',
    'Industrious Manushya',
    'Resplendent Garuda',
    'Benevolent Divya',
    'Founders of Neh'
];

async function validateUser(email) {
    const issues = [];
    const warnings = [];
    const info = {};

    // 1. User exists
    const user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [email.toLowerCase()]);
    if (!user) {
        return { email, status: 'NOT_FOUND', issues: ['User not in database'], warnings: [], info: {} };
    }

    info.backerId = user.backer_number;
    info.rewardTitle = user.reward_title || 'N/A';
    info.pledgeAmount = user.pledge_amount || 0;

    // 2. Email normalized
    if (user.email !== user.email.toLowerCase()) {
        warnings.push('Email not lowercase');
    }

    // 3. Backer data consistency
    const hasBackerNumber = !!user.backer_number;
    const hasPledgeAmount = !!user.pledge_amount;
    const hasRewardTitle = !!user.reward_title;

    if (hasBackerNumber || hasPledgeAmount || hasRewardTitle) {
        if (!hasBackerNumber) warnings.push('Missing backer_number');
        if (!hasPledgeAmount) warnings.push('Missing pledge_amount');
        if (!hasRewardTitle) warnings.push('Missing reward_title');
    }

    // 4. Valid reward tier
    if (user.reward_title) {
        const valid = VALID_TIERS.some(t => user.reward_title.toLowerCase().includes(t.toLowerCase()));
        if (!valid) issues.push(`Unknown reward tier: ${user.reward_title}`);
    }

    // 5. Pledge amount positive for backers
    if (user.backer_number && (!user.pledge_amount || user.pledge_amount <= 0)) {
        issues.push('Backer has non-positive pledge amount');
    }

    // 6. Password exists
    if (!user.password) {
        issues.push('No password set');
    }

    // 7. JSON fields valid
    if (user.kickstarter_items) {
        try { JSON.parse(user.kickstarter_items); } catch { issues.push('kickstarter_items invalid JSON'); }
    }
    if (user.kickstarter_addons) {
        try { JSON.parse(user.kickstarter_addons); } catch { issues.push('kickstarter_addons invalid JSON'); }
    }

    // 8. Orders
    const orders = await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
    info.orderCount = orders.length;

    if (orders.length === 0) {
        issues.push('No order found');
    }

    for (const order of orders) {
        info.orderId = order.id;
        info.paymentStatus = order.payment_status;
        info.paid = order.paid;
        info.total = order.total;
        info.shippingCost = order.shipping_cost;

        // Shipping address JSON valid
        if (order.shipping_address && order.shipping_address !== '{}') {
            try {
                const addr = JSON.parse(order.shipping_address);
                info.city = addr.city || '?';
                info.country = addr.country || '?';
                if (!addr.fullName) warnings.push(`Order #${order.id}: address missing fullName`);
                if (!addr.addressLine1) warnings.push(`Order #${order.id}: address missing addressLine1`);
                if (!addr.city) warnings.push(`Order #${order.id}: address missing city`);
                if (!addr.country) warnings.push(`Order #${order.id}: address missing country`);
            } catch {
                issues.push(`Order #${order.id}: shipping_address invalid JSON`);
            }
        } else {
            warnings.push(`Order #${order.id}: no shipping address`);
        }

        // new_addons JSON valid
        if (order.new_addons) {
            try {
                const items = JSON.parse(order.new_addons);
                info.addonCount = items.length;
                if (items.length > 0) {
                    info.addonNames = items.map(i => i.name).join(', ');
                }
            } catch {
                issues.push(`Order #${order.id}: new_addons invalid JSON`);
            }
        }

        // Payment status check
        if (order.paid === 1) {
            const validPaid = ['succeeded', 'charged'];
            if (!validPaid.includes(order.payment_status)) {
                warnings.push(`Order #${order.id}: paid=1 but status='${order.payment_status}'`);
            }
        }

        // Total = subtotal + shipping
        const expectedTotal = (order.addons_subtotal || 0) + (order.shipping_cost || 0);
        if (Math.abs(expectedTotal - (order.total || 0)) > 0.01) {
            warnings.push(`Order #${order.id}: total ($${order.total}) != subtotal ($${order.addons_subtotal}) + shipping ($${order.shipping_cost})`);
        }

        // Stripe consistency
        if (order.stripe_payment_method_id && !order.stripe_customer_id) {
            warnings.push(`Order #${order.id}: has payment_method but no customer_id`);
        }
    }

    const status = issues.length > 0 ? 'FAIL' : (warnings.length > 0 ? 'WARN' : 'PASS');
    return { email, status, issues, warnings, info };
}

async function main() {
    console.log('\n🔍 Batch Validate - Order Zero Users\n');

    const workbook = XLSX.readFile('utility/Found Data PM.xlsx');
    const sheet = workbook.Sheets['Order Zero'];
    const data = XLSX.utils.sheet_to_json(sheet);

    const validRows = data.filter(row =>
        row['Order amount'] !== undefined && row['Order amount'] !== null &&
        row['Shipping amount'] !== undefined && row['Shipping amount'] !== null &&
        row['Shipping Address']
    );

    console.log(`Validating ${validRows.length} users...\n`);

    const results = { pass: [], warn: [], fail: [], notFound: [] };

    for (const row of validRows) {
        const email = row.Email;
        const result = await validateUser(email);

        if (result.status === 'NOT_FOUND') {
            results.notFound.push(result);
            console.log(`  ❌ ${email} — NOT FOUND`);
        } else if (result.status === 'FAIL') {
            results.fail.push(result);
            console.log(`  ✗ ${email} (backer #${result.info.backerId}) — FAIL`);
            result.issues.forEach(i => console.log(`      Issue: ${i}`));
            result.warnings.forEach(w => console.log(`      Warn: ${w}`));
        } else if (result.status === 'WARN') {
            results.warn.push(result);
            console.log(`  ⚠ ${email} (backer #${result.info.backerId}) — WARN`);
            result.warnings.forEach(w => console.log(`      ${w}`));
        } else {
            results.pass.push(result);
            console.log(`  ✓ ${email} (backer #${result.info.backerId})`);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`  ✓ PASS:      ${results.pass.length}`);
    console.log(`  ⚠ WARNINGS:  ${results.warn.length}`);
    console.log(`  ✗ FAIL:      ${results.fail.length}`);
    console.log(`  ❌ NOT FOUND: ${results.notFound.length}`);
    console.log(`  TOTAL:       ${validRows.length}`);
    console.log('='.repeat(60));

    if (results.fail.length > 0) {
        console.log('\n❌ FAILURES:');
        results.fail.forEach(r => {
            console.log(`\n  ${r.email} (backer #${r.info.backerId}):`);
            r.issues.forEach(i => console.log(`    - ${i}`));
        });
    }

    if (results.warn.length > 0) {
        console.log('\n⚠️  WARNINGS:');
        results.warn.forEach(r => {
            console.log(`\n  ${r.email} (backer #${r.info.backerId}):`);
            r.warnings.forEach(w => console.log(`    - ${w}`));
        });
    }

    console.log('\n');
}

initConnection();
setTimeout(async () => {
    try {
        await main();
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await closeConnections();
        process.exit(0);
    }
}, 1000);
