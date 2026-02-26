#!/usr/bin/env node
/**
 * Cleanup duplicate orders.
 * Each user should have at most one order. This script finds users with
 * multiple orders, keeps the best one (latest completed, or latest pending),
 * and deletes the rest along with their email_logs.
 *
 * Usage:
 *   node utility/cleanup-duplicate-orders.js              # dry run (default)
 *   node utility/cleanup-duplicate-orders.js --execute     # actually delete
 *   node utility/cleanup-duplicate-orders.js --execute --include-test  # include test accounts
 */

require('dotenv').config();
const { Pool } = require('pg');

const DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/maya_db';
const pool = new Pool({ connectionString: DB_URL });

const EXECUTE = process.argv.includes('--execute');
const INCLUDE_TEST = process.argv.includes('--include-test');

const TEST_EMAILS = [
    'test@example.com', 'anmol@entermaya.com', 'anmoltest@entermaya.com',
    'yashtest@entermaya.com', 'yadavmehul24@gmail.com', 'sahil.netwin@gmail.com',
    'ranmol30@gmail.com'
];

const COMPLETED_STATUSES = ['card_saved', 'succeeded', 'charged'];

async function run() {
    const client = await pool.connect();

    try {
        // Find all users with more than one order
        const { rows: duplicateUsers } = await client.query(`
            SELECT user_id, COUNT(*) as order_count
            FROM orders
            GROUP BY user_id
            HAVING COUNT(*) > 1
            ORDER BY COUNT(*) DESC
        `);

        console.log(`\nFound ${duplicateUsers.length} users with multiple orders\n`);

        let totalToDelete = 0;
        let totalToKeep = 0;
        const ordersToDelete = [];
        const skippedUsers = [];

        for (const { user_id, order_count } of duplicateUsers) {
            // Get user info
            const { rows: [user] } = await client.query(
                'SELECT id, email, backer_number FROM users WHERE id = $1', [user_id]
            );
            const email = user?.email || `(user_id=${user_id})`;
            const backer = user?.backer_number || '-';

            // Skip test accounts unless --include-test
            if (!INCLUDE_TEST && TEST_EMAILS.includes(email.toLowerCase())) {
                skippedUsers.push({ email, backer, order_count, reason: 'test account' });
                continue;
            }

            // Get all orders for this user, newest first
            const { rows: orders } = await client.query(
                `SELECT id, payment_status, paid, total, new_addons, created_at
                 FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
                [user_id]
            );

            // Pick the order to keep:
            // 1. Prefer the latest completed order (card_saved/succeeded/charged)
            // 2. If none completed, keep the latest pending
            // 3. If there's a 'succeeded' or 'charged' (actually paid), prefer that over card_saved
            const paidOrder = orders.find(o => ['succeeded', 'charged'].includes(o.payment_status));
            const completedOrder = orders.find(o => COMPLETED_STATUSES.includes(o.payment_status));
            const keeper = paidOrder || completedOrder || orders[0]; // newest fallback

            const toDelete = orders.filter(o => o.id !== keeper.id);

            totalToKeep++;
            totalToDelete += toDelete.length;

            console.log(`── Backer #${backer} (${email}) — ${orders.length} orders`);
            console.log(`   KEEP:   order #${keeper.id}  ${keeper.payment_status}  $${keeper.total}  ${keeper.created_at}`);
            for (const d of toDelete) {
                console.log(`   DELETE: order #${d.id}  ${d.payment_status}  $${d.total}  ${d.created_at}`);
                ordersToDelete.push(d.id);
            }
            console.log('');
        }

        if (skippedUsers.length > 0) {
            console.log(`── Skipped ${skippedUsers.length} test accounts (use --include-test to include):`);
            for (const s of skippedUsers) {
                console.log(`   ${s.email} (backer #${s.backer}) — ${s.order_count} orders`);
            }
            console.log('');
        }

        console.log('═══════════════════════════════════════');
        console.log(`  Users with duplicates: ${duplicateUsers.length}`);
        console.log(`  Orders to keep:        ${totalToKeep}`);
        console.log(`  Orders to delete:      ${totalToDelete}`);
        console.log(`  Test accounts skipped: ${skippedUsers.length}`);
        console.log('═══════════════════════════════════════\n');

        if (ordersToDelete.length === 0) {
            console.log('Nothing to delete.');
            return;
        }

        if (!EXECUTE) {
            console.log('DRY RUN — no changes made. Run with --execute to delete.\n');
            return;
        }

        // Execute deletion inside a transaction
        console.log('Executing deletion...\n');
        await client.query('BEGIN');

        try {
            // Delete dependent email_logs first
            const { rowCount: emailLogsDeleted } = await client.query(
                `DELETE FROM email_logs WHERE order_id = ANY($1::int[])`,
                [ordersToDelete]
            );
            console.log(`  Deleted ${emailLogsDeleted} email_log rows`);

            // Delete the duplicate orders
            const { rowCount: ordersDeleted } = await client.query(
                `DELETE FROM orders WHERE id = ANY($1::int[])`,
                [ordersToDelete]
            );
            console.log(`  Deleted ${ordersDeleted} orders`);

            await client.query('COMMIT');
            console.log('\n  ✓ Transaction committed successfully.\n');

            // Verify: no user should have more than 1 order now
            const { rows: remaining } = await client.query(`
                SELECT user_id, COUNT(*) as cnt FROM orders
                GROUP BY user_id HAVING COUNT(*) > 1
            `);
            const nonTestRemaining = INCLUDE_TEST ? remaining : remaining.filter(r => {
                // quick check
                return true;
            });
            if (remaining.length === 0) {
                console.log('  ✓ Verification passed: every user now has at most 1 order.\n');
            } else {
                console.log(`  ⚠ ${remaining.length} users still have multiple orders (likely skipped test accounts).\n`);
            }
        } catch (err) {
            await client.query('ROLLBACK');
            console.error('\n  ✗ Error during deletion — ROLLED BACK. No data changed.');
            console.error('   ', err.message);
        }

    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
