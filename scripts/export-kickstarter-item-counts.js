#!/usr/bin/env node
/**
 * Export non-guest users + Kickstarter item counts to XLSX.
 *
 * Usage:
 *   node scripts/export-kickstarter-item-counts.js
 *   node scripts/export-kickstarter-item-counts.js --out kickstarter_item_counts.xlsx
 *
 * Notes:
 * - "Guest users" are excluded by default (no backer_number/pledge_amount/reward_title).
 * - Columns include Name, Email, Country, plus one column per kickstarter_items key
 *   found in the DB (and always includes the known keys from lookup-user output).
 */

require('dotenv').config();

// Match utility/lookup-user.js: prefer local Postgres when DATABASE_URL isn't set,
// so we don't silently export from an empty local SQLite DB.
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/maya_db';
}

const path = require('path');
const XLSX = require('xlsx');

const { initConnection, closeConnections, query } = require('../config/database');

const KNOWN_ITEM_KEYS = [
    'ebook',
    'audiobook',
    'hardcover',
    'book2_hardcover',
    'book3_hardcover',
    'lorebook',
    'built_env',
    'pendant',
    'book2_live',
    'book3_live'
];

function parseArgs(argv) {
    const args = { out: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--out' || a === '-o') {
            args.out = argv[i + 1];
            i++;
        } else if (a === '--help' || a === '-h') {
            args.help = true;
        }
    }
    return args;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function safeJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value && !Array.isArray(value) ? value : {};
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function uniqPreserveOrder(arr) {
    const seen = new Set();
    const out = [];
    for (const v of arr) {
        if (!seen.has(v)) {
            seen.add(v);
            out.push(v);
        }
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(
            [
                'Usage:',
                '  node scripts/export-kickstarter-item-counts.js',
                '  node scripts/export-kickstarter-item-counts.js --out kickstarter_item_counts.xlsx',
                '',
                'Exports Name, Email, Country and per-item counts (kickstarter_items) for non-guest users.'
            ].join('\n')
        );
        process.exit(0);
    }

    const outPath = path.resolve(args.out || 'kickstarter_item_counts.xlsx');

    initConnection();
    // database.js initializes tables async; give it a moment to connect.
    await sleep(750);

    const users = await query(
        `
        SELECT
            id,
            email,
            backer_name,
            shipping_country,
            backer_number,
            pledge_amount,
            reward_title,
            kickstarter_items
        FROM users
        WHERE email IS NOT NULL
          AND (
                backer_number IS NOT NULL
             OR pledge_amount IS NOT NULL
             OR (reward_title IS NOT NULL AND TRIM(reward_title) <> '')
          )
        ORDER BY id
        `
    );

    const perUser = [];
    const discoveredKeys = new Set();

    for (const u of users) {
        const items = safeJsonObject(u.kickstarter_items);
        for (const k of Object.keys(items)) discoveredKeys.add(k);

        perUser.push({
            name: u.backer_name || '',
            email: u.email || '',
            country: u.shipping_country || '',
            items
        });
    }

    const extraKeys = Array.from(discoveredKeys).filter((k) => !KNOWN_ITEM_KEYS.includes(k));
    extraKeys.sort((a, b) => a.localeCompare(b));
    const itemKeys = uniqPreserveOrder([...KNOWN_ITEM_KEYS, ...extraKeys]);

    const header = ['Name', 'Email', 'Country', ...itemKeys];
    const aoa = [header];

    for (const row of perUser) {
        const r = [row.name, row.email, row.country];
        for (const key of itemKeys) {
            const raw = row.items?.[key];
            const n = Number(raw);
            r.push(Number.isFinite(n) ? n : 0);
        }
        aoa.push(r);
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, 'Kickstarter Items');
    XLSX.writeFile(wb, outPath);

    console.log(`✅ Wrote ${perUser.length} user row(s) to: ${outPath}`);
    console.log(`ℹ️  Item columns: ${itemKeys.length}`);
}

main()
    .catch((err) => {
        console.error('❌ Export failed:', err?.message || err);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            await closeConnections();
        } catch (_) {}
    });

