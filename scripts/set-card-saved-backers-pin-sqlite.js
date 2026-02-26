/**
 * Set PIN=1234 for SQLite backers with card_saved.
 *
 * Target: local SQLite DB only (database.db).
 * Condition: user is a Kickstarter backer (has backer_number OR pledge_amount OR reward_title)
 *            AND has at least one order with payment_status='card_saved'
 *            AND has a saved payment method on that order.
 *
 * Usage:
 *   node scripts/set-card-saved-backers-pin-sqlite.js
 *   node scripts/set-card-saved-backers-pin-sqlite.js /path/to/database.db
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const pin = '1234';
const arg = process.argv[2];
if (arg === '--help' || arg === '-h') {
    console.log(`
Usage:
  node scripts/set-card-saved-backers-pin-sqlite.js
  node scripts/set-card-saved-backers-pin-sqlite.js /path/to/database.db

Sets PIN=1234 (bcrypt-hashed) for Kickstarter backers in a local SQLite DB
who have at least one order with payment_status='card_saved' and a saved
payment method.
`.trim());
    process.exit(0);
}

const dbPath = arg
    ? path.resolve(arg)
    : path.join(__dirname, '..', 'database.db');

// Safety: this script is meant for local SQLite only.
if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).startsWith('postgres')) {
    console.error('❌ Refusing to run: DATABASE_URL is set (Postgres). This script is SQLite-only.');
    process.exit(1);
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('❌ Failed to open SQLite DB:', err.message);
        process.exit(1);
    }
});

function all(sql, params) {
    return new Promise((resolve, reject) => {
        db.all(sql, params || [], (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

function run(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params || [], function(err) {
            if (err) return reject(err);
            resolve({ changes: this.changes || 0 });
        });
    });
}

async function main() {
    console.log('🔐 Setting PIN for card_saved backers (SQLite)\n');
    console.log('DB:', dbPath);

    // Ensure pin_hash exists (older DBs might not have the column yet).
    const cols = await all("PRAGMA table_info(users)");
    const hasPinHash = cols.some((c) => String(c.name).toLowerCase() === 'pin_hash');
    if (!hasPinHash) {
        console.log('ℹ️  users.pin_hash missing; adding column...');
        await run('ALTER TABLE users ADD COLUMN pin_hash TEXT');
    }

    const candidates = await all(
        `
        SELECT DISTINCT u.id, u.email, u.backer_number
        FROM users u
        JOIN orders o ON o.user_id = u.id
        WHERE o.payment_status = 'card_saved'
          AND o.stripe_payment_method_id IS NOT NULL
          AND (
                u.backer_number IS NOT NULL
             OR u.pledge_amount IS NOT NULL
             OR (u.reward_title IS NOT NULL AND TRIM(u.reward_title) <> '')
          )
        ORDER BY u.id
        `
    );

    if (candidates.length === 0) {
        console.log('\n✅ No matching users found (nothing to update).');
        db.close();
        return;
    }

    console.log(`\nFound ${candidates.length} matching backer(s). Updating pin_hash...`);
    const hash = await bcrypt.hash(pin, 10);

    const result = await run(
        `
        UPDATE users
        SET pin_hash = ?
        WHERE id IN (
            SELECT DISTINCT u.id
            FROM users u
            JOIN orders o ON o.user_id = u.id
            WHERE o.payment_status = 'card_saved'
              AND o.stripe_payment_method_id IS NOT NULL
              AND (
                    u.backer_number IS NOT NULL
                 OR u.pledge_amount IS NOT NULL
                 OR (u.reward_title IS NOT NULL AND TRIM(u.reward_title) <> '')
              )
        )
        `,
        [hash]
    );

    console.log(`✅ Updated ${result.changes} user(s). New PIN: ${pin}`);
    console.log('ℹ️  PIN is stored as bcrypt hash (cannot be retrieved).');

    db.close();
}

main().catch((err) => {
    console.error('❌ Error:', err?.message || err);
    try { db.close(); } catch (_) {}
    process.exit(1);
});

