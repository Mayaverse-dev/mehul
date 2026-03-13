/**
 * Audience / Segment Service
 *
 * Manages contacts and segment membership via the proprietary mail service.
 * Segment IDs are hardcoded. Only touches segments that actually changed
 * (diff-based). No rate limit on the mail service, so ops fire in parallel.
 */

const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/database');
const { classifyUser, CLASSIFY_SINGLE_USER_QUERY, SEGMENT_TAGS } = require('../utils/classifyUser');

let cachedToken = null;

const SEGMENT_IDS = {
    dropped:         'b0e86c1a-8593-4f31-8b7f-f45cfca5a346',
    dropped_to_paid: 'd378b4b5-cebf-4212-acc8-ce842b6f4c5e',
    regular:         'cc2178fe-acea-483c-b7d1-78aca434ddaf',
    late_backer:     '0216a911-ee31-4a6d-b2b4-c08514957b71',
    shipping_paid:   '690d3f38-247b-4077-a467-da76cb2e9242',
    unpaid_shipping: '1f1cf15e-78fc-4195-af4d-9766215212c6',
    addons_bought:   '9288969c-22ca-483f-a7e2-85cdd4c90d0a',
    upgraded:        '6fa620c7-df69-4e23-a8b6-c5e280fafe1e',
};

function getBaseUrl() {
    return process.env.MAIL_SERVICE_URL;
}

function getAuthToken() {
    const secret = process.env.MAIL_SERVICE_JWT_SECRET;
    if (!secret) return null;
    if (cachedToken) return cachedToken;
    cachedToken = jwt.sign({ sub: 'maya-store' }, secret, { algorithm: 'HS256' });
    return cachedToken;
}

async function mailFetch(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${getBaseUrl()}${path}`, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { ok: res.ok, status: res.status, data: json };
}

/**
 * Reclassify a user and sync their segment memberships.
 * Only adds/removes segments that actually differ from the current state.
 * Safe to call from any code path — errors are logged, never thrown.
 */
async function syncUserAudiences(userId) {
    if (!getBaseUrl()) return;

    try {
        const row = await queryOne(CLASSIFY_SINGLE_USER_QUERY, [userId]);
        if (!row || !row.email) return;

        const desiredTags = classifyUser(row);
        const email = row.email;
        const encodedEmail = encodeURIComponent(email);

        const name = (row.backer_name || '').trim();
        const spaceIdx = name.indexOf(' ');
        const firstName = spaceIdx > 0 ? name.slice(0, spaceIdx) : name;
        const lastName = spaceIdx > 0 ? name.slice(spaceIdx + 1) : '';

        // Ensure contact exists and fetch current segments in parallel
        const [, currentRes] = await Promise.all([
            mailFetch('POST', '/api/contacts', {
                email,
                first_name: firstName || undefined,
                last_name: lastName || undefined,
            }),
            mailFetch('GET', `/api/contacts/${encodedEmail}/segments`),
        ]);

        const currentSegIds = new Set();
        if (currentRes.ok && currentRes.data?.segments) {
            for (const seg of currentRes.data.segments) {
                currentSegIds.add(seg.id);
            }
        }

        const managedIds = new Set(Object.values(SEGMENT_IDS));
        const desiredIds = new Set(desiredTags.map(t => SEGMENT_IDS[t]).filter(Boolean));

        const toAdd = [];
        const toRemove = [];
        for (const [tag, segId] of Object.entries(SEGMENT_IDS)) {
            if (desiredIds.has(segId) && !currentSegIds.has(segId)) {
                toAdd.push({ tag, segId });
            } else if (!desiredIds.has(segId) && currentSegIds.has(segId) && managedIds.has(segId)) {
                toRemove.push({ tag, segId });
            }
        }

        if (toAdd.length === 0 && toRemove.length === 0) {
            console.log(`✓ Segments already correct for user ${userId} (${email}): [${desiredTags.join(', ')}]`);
            return;
        }

        const ops = [
            ...toAdd.map(({ tag, segId }) =>
                mailFetch('POST', `/api/contacts/${encodedEmail}/segments/${segId}`)
                    .then(res => ({ tag, action: 'add', ...res }))
            ),
            ...toRemove.map(({ tag, segId }) =>
                mailFetch('DELETE', `/api/contacts/${encodedEmail}/segments/${segId}`)
                    .then(res => ({ tag, action: 'remove', ...res }))
            ),
        ];

        const results = await Promise.allSettled(ops);
        const failures = results
            .map(r => r.status === 'fulfilled' ? r.value : { tag: '?', action: '?', ok: false, data: r.reason?.message })
            .filter(r => !r.ok);

        for (const f of failures) {
            console.error(`  ⚠️  ${f.action} "${f.tag}" failed (${f.status}):`, f.data);
        }

        const added = toAdd.map(o => `+${o.tag}`);
        const removed = toRemove.map(o => `-${o.tag}`);
        console.log(`✓ Synced segments for user ${userId} (${email}): [${desiredTags.join(', ')}] (${[...added, ...removed].join(', ')})${failures.length ? ` (${failures.length} failed)` : ''}`);
    } catch (err) {
        console.error(`⚠️  Failed to sync segments for user ${userId}:`, err.message);
    }
}

module.exports = { syncUserAudiences };
