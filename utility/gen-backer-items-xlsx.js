#!/usr/bin/env node
/**
 * Generate backer items breakdown XLSX with sheets per country.
 */
require('dotenv').config();
const { Pool } = require('pg');
const xlsx = require('xlsx');

const DB_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/maya_db';
const pool = new Pool({ connectionString: DB_URL });

const { TIER_ITEMS, ITEM_NAMES_SHORT: ITEM_NAMES, ADDON_KEY_MAP: ADDON_KEYS } = require('../config/tier-items');

function countForGroup(backers) {
    const tierCounts = {};
    const itemCounts = {};
    Object.values(ITEM_NAMES).forEach(n => itemCounts[n] = 0);

    for (const b of backers) {
        const tier = b.reward_title;
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;

        const tierItems = TIER_ITEMS[tier] || [];
        for (const key of tierItems) {
            itemCounts[ITEM_NAMES[key]] = (itemCounts[ITEM_NAMES[key]] || 0) + 1;
        }

        if (b.kickstarter_addons && b.kickstarter_addons !== '{}' && b.kickstarter_addons !== 'null') {
            try {
                const addons = JSON.parse(b.kickstarter_addons);
                for (const [key, value] of Object.entries(addons)) {
                    const mapped = ADDON_KEYS[key];
                    if (!mapped) continue;
                    const qty = typeof value === 'object' ? (value.quantity || 1) : (parseInt(value) || 0);
                    if (qty > 0) {
                        itemCounts[ITEM_NAMES[mapped]] = (itemCounts[ITEM_NAMES[mapped]] || 0) + qty;
                    }
                }
            } catch {}
        }
    }

    const tierRows = [['Pledge Tier', 'Total']];
    const sortedTiers = Object.entries(tierCounts).sort((a, b) => b[1] - a[1]);
    for (const [tier, count] of sortedTiers) tierRows.push([tier, count]);
    tierRows.push([]);

    const itemRows = [['Item', 'Total']];
    const sortedItems = Object.entries(itemCounts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    for (const [item, count] of sortedItems) itemRows.push([item, count]);

    return [...tierRows, ...itemRows];
}

async function run() {
    const client = await pool.connect();

    const { rows: allBackers } = await client.query(`
        SELECT u.id, u.reward_title, u.kickstarter_addons, u.shipping_country
        FROM users u
        WHERE u.backer_number IS NOT NULL
          AND u.reward_title IS NOT NULL AND u.reward_title != ''
    `);

    const countryGroups = {
        'IN': ['IN', 'India'],
        'US': ['US', 'USA'],
        'GB': ['GB', 'UK'],
        'AU': ['AU'],
        'CA': ['CA']
    };

    function matchesCountry(b, code) {
        const variants = countryGroups[code];
        if (!variants) return b.shipping_country === code;
        return variants.includes(b.shipping_country);
    }

    const countryMap = { US: 'USA', GB: 'UK', AU: 'Australia', CA: 'Canada', IN: 'India' };
    const countries = ['ALL', 'US', 'IN', 'GB', 'AU', 'CA'];

    const wb = xlsx.utils.book_new();

    for (const code of countries) {
        const filtered = code === 'ALL' ? allBackers : allBackers.filter(b => matchesCountry(b, code));
        const label = code === 'ALL' ? 'All Backers' : (countryMap[code] || code);
        const data = countForGroup(filtered);
        const ws = xlsx.utils.aoa_to_sheet(data);
        ws['!cols'] = [{ wch: 30 }, { wch: 10 }];
        xlsx.utils.book_append_sheet(wb, ws, label);
    }

    const outPath = 'utility/backer-items-breakdown.xlsx';
    xlsx.writeFile(wb, outPath);
    console.log('Written to', outPath);

    client.release();
    await pool.end();
}

run().catch(err => { console.error(err.message); process.exit(1); });
