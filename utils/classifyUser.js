/**
 * User Classification for Resend Email Segments
 *
 * Classifies a user into 0+ of 8 segment tags based on a joined
 * users + orders row. Used by both the CSV export script and the
 * live audience sync service.
 */

const SEGMENT_TAGS = [
    'dropped',
    'dropped_to_paid',
    'regular',
    'late_backer',
    'shipping_paid',
    'unpaid_shipping',
    'addons_bought',
    'upgraded'
];

const CLASSIFY_USER_QUERY = `
    SELECT u.id, u.email, u.backer_name, u.backer_number,
           u.pledge_amount, u.reward_title, u.pledged_status,
           u.is_late_pledge, u.kickstarter_addons,
           o.id AS order_id, o.new_addons, o.payment_status, o.paid, o.total
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id`;

const CLASSIFY_SINGLE_USER_QUERY = CLASSIFY_USER_QUERY + ' WHERE u.id = $1';

/**
 * Classify a joined user+order row into segment tags.
 * @param {Object} row - A row from CLASSIFY_USER_QUERY
 * @returns {string[]} Array of segment tag strings
 */
function classifyUser(row) {
    const tags = [];

    const isBacker = !!(row.backer_number || row.pledge_amount || row.reward_title);
    const isDropped = isBacker && (row.pledged_status || '').toLowerCase() === 'dropped';
    const isLate = row.is_late_pledge === 1;
    const hasOrder = !!row.order_id;
    const hasCompletedOrder = hasOrder &&
        ['card_saved', 'succeeded', 'charged'].includes(row.payment_status);
    const shippingPaid = hasOrder &&
        (row.paid === 1 || ['card_saved', 'charged', 'succeeded'].includes(row.payment_status));

    // Dropped vs dropped-to-paid (mutually exclusive)
    if (isDropped && !hasCompletedOrder) tags.push('dropped');
    if (isDropped && hasCompletedOrder)  tags.push('dropped_to_paid');

    if (isBacker && !isDropped && !isLate) tags.push('regular');
    if (isLate) tags.push('late_backer');

    if (shippingPaid) tags.push('shipping_paid');
    if ((isBacker || isLate) && !shippingPaid) tags.push('unpaid_shipping');

    // Parse order items for addon/upgrade detection
    let orderItems = [];
    try { orderItems = JSON.parse(row.new_addons || '[]'); } catch {}

    let ksAddons = {};
    try { ksAddons = JSON.parse(row.kickstarter_addons || '{}'); } catch {}

    const platformAddons = orderItems.filter(i =>
        !i.isPaidKickstarterPledge &&
        !i.isOriginalPledge &&
        !i.isDroppedBackerPledge &&
        !i.isPledgeUpgrade &&
        !i.isKickstarterAddon
    );
    if (Object.keys(ksAddons).length > 0 || platformAddons.length > 0) {
        tags.push('addons_bought');
    }

    if (orderItems.some(i => i.isPledgeUpgrade)) {
        tags.push('upgraded');
    }

    return tags;
}

module.exports = {
    classifyUser,
    CLASSIFY_USER_QUERY,
    CLASSIFY_SINGLE_USER_QUERY,
    SEGMENT_TAGS
};
