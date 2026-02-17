/**
 * Helper Utilities
 * OTP, magic links, shipping, price validation, and email logging
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query, queryOne, execute } = require('../config/database');

// Auth constants
const OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAGIC_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_STALE_DAYS = 7;
const PIN_LOGIN_GRACE_DAYS = 7;

// Generate a 4-digit OTP code
function generateOtpCode() {
    return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Alias for generateOtpCode
function generateOtp() {
    return String(crypto.randomInt(1000, 10000)).padStart(4, '0');
}

// Generate a magic link token
function generateMagicToken() {
    return crypto.randomBytes(24).toString('hex');
}

// Generate a random password placeholder for shadow accounts
function generateRandomPassword(length = 16) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// Determine if a user's last login is stale and needs OTP re-verification
function isLoginStale(user) {
    if (!user || !user.last_login_at) return true;
    const last = new Date(user.last_login_at).getTime();
    return Date.now() - last > LOGIN_STALE_DAYS * 24 * 60 * 60 * 1000;
}

// Alternative isLoginStale that accepts lastLoginAt directly
function isLoginStaleByDate(lastLoginAt) {
    if (!lastLoginAt) return true;
    const last = new Date(lastLoginAt).getTime();
    if (Number.isNaN(last)) return true;
    const diffDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
    return diffDays > PIN_LOGIN_GRACE_DAYS;
}

// Check if user needs OTP
function needsOtp(user) {
    if (!user) return true;
    if (!user.pin_hash) return true;
    if (!user.last_login_at) return true;
    const last = new Date(user.last_login_at);
    const staleMs = LOGIN_STALE_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - last.getTime() > staleMs;
}

// Update user's last login timestamp
async function updateLastLogin(userId) {
    const now = new Date().toISOString();
    await execute('UPDATE users SET last_login_at = $1 WHERE id = $2', [now, userId]);
}

// Get user by email (case-insensitive)
async function getUserByEmail(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return null;
    return await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalized]);
}

// Create shadow user
async function createShadowUser(email) {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return null;
    const dummyPassword = await bcrypt.hash(`shadow-${crypto.randomBytes(8).toString('hex')}`, 10);
    await execute(`INSERT INTO users (email, password) VALUES ($1, $2)`, [normalized, dummyPassword]);
    return await getUserByEmail(normalized);
}

// Ensure a user exists for the given email; create a shadow user if missing (case-insensitive check)
async function ensureUserByEmail(email, name) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    let user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalized]);
    if (user) return user;

    const randomPassword = `shadow-${crypto.randomUUID()}`;
    const hash = await bcrypt.hash(randomPassword, 10);

    await execute(
        `INSERT INTO users (email, password, backer_name)
         VALUES ($1, $2, $3)`,
        [normalized, hash, name || null]
    );

    user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [normalized]);
    return user;
}

// Find existing user by email or create a shadow user (no PIN yet) - case-insensitive check
async function findOrCreateShadowUser(email, name = '') {
    const { isPostgres } = require('../config/database');
    
    if (!email) throw new Error('Email is required to create shadow user');

    const normalized = email.trim().toLowerCase();

    // Check if user exists (case-insensitive)
    const existing = await queryOne('SELECT id FROM users WHERE LOWER(email) = $1', [normalized]);
    if (existing && existing.id) return existing.id;

    // Create placeholder password
    const password = generateRandomPassword();
    const hash = await bcrypt.hash(password, 10);

    // Insert user with normalized (lowercase) email
    if (isPostgres()) {
        const created = await queryOne(
            'INSERT INTO users (email, password, backer_name) VALUES ($1, $2, $3) RETURNING id',
            [normalized, hash, name || null]
        );
        return created.id;
    } else {
        await execute('INSERT INTO users (email, password, backer_name) VALUES (?, ?, ?)', [normalized, hash, name || null]);
        const created = await queryOne('SELECT id FROM users WHERE LOWER(email) = $1', [normalized]);
        return created?.id;
    }
}

// Helper function to log emails to database
async function logEmail({ orderId, userId, recipientEmail, emailType, subject, status, resendMessageId, errorMessage }) {
    try {
        await execute(`INSERT INTO email_logs (
            order_id, user_id, recipient_email, email_type, subject, 
            status, resend_message_id, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, 
        [
            orderId || null,
            userId || null,
            recipientEmail,
            emailType,
            subject,
            status,
            resendMessageId || null,
            errorMessage || null
        ]);
    } catch (err) {
        console.error('⚠️  Failed to log email to database:', err.message);
        // Don't fail the operation if logging fails
    }
}

// Calculate shipping based on country and cart items
function calculateShipping(country, cartItems = []) {
    const { shippingRates, resolveZone } = require('../config/shipping-rates');

    const normalize = (str = '') => str.trim().toLowerCase();
    const zone = resolveZone(country || '');
    const rates = shippingRates[zone] || shippingRates['REST OF WORLD'];

    let total = 0;

    // Identify pledge tier in cart (by name match)
    const pledgeEntry = cartItems.find(item => {
        const n = normalize(item.name || '');
        return [
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh'
        ].some(key => n.includes(key));
    });

    if (pledgeEntry) {
        const pledgeName = [
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh'
        ].find(key => normalize(pledgeEntry.name || '').includes(key));
        if (pledgeName && rates.pledges?.[pledgeName]) {
            total += rates.pledges[pledgeName];
        }
    }

    // Add-on shipping (Built Environments / Lorebook / Paperback / Hardcover)
    cartItems.forEach(item => {
        const n = normalize(item.name || '');
        const qty = item.quantity || 1;
        if (n.includes('built environments')) {
            total += (rates.addons?.['Built Environments'] || 0) * qty;
        } else if (n.includes('lorebook')) {
            total += (rates.addons?.['Lorebook'] || 0) * qty;
        } else if (n.includes('paperback')) {
            total += (rates.addons?.['Paperback'] || 0) * qty;
        } else if (n.includes('hardcover')) {
            total += (rates.addons?.['Hardcover'] || 0) * qty;
        }
    });

    return total;
}

// Helper function to validate cart prices server-side (security critical!)
// isBacker: true = Kickstarter backer (gets backer prices), false = guest/non-backer (retail prices)
async function validateCartPrices(cartItems, isBacker) {
    let serverTotal = 0;
    const validatedItems = [];
    
    for (const item of cartItems) {
        // Special handling for pledge upgrades - use the difference price from cart
        if (item.isPledgeUpgrade) {
            const quantity = parseInt(item.quantity) || 1;
            const pledgeUpgradePrice = parseFloat(item.price) || 0;
            const itemTotal = pledgeUpgradePrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: pledgeUpgradePrice,
                quantity: quantity,
                subtotal: itemTotal,
                isPledgeUpgrade: true
            });
            continue;
        }
        
        // Special handling for original pledges (dropped backers)
        if (item.isOriginalPledge || item.isDroppedBackerPledge) {
            const quantity = parseInt(item.quantity) || 1;
            const pledgePrice = parseFloat(item.price) || 0;
            const itemTotal = pledgePrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: pledgePrice,
                quantity: quantity,
                subtotal: itemTotal,
                isOriginalPledge: item.isOriginalPledge || false,
                isDroppedBackerPledge: item.isDroppedBackerPledge || false
            });
            continue;
        }
        
        // Special handling for original Kickstarter addons (dropped backers)
        if (item.isOriginalAddon) {
            const quantity = parseInt(item.quantity) || 1;
            const addonPrice = parseFloat(item.price) || 0;
            const itemTotal = addonPrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: addonPrice,
                quantity: quantity,
                subtotal: itemTotal,
                isOriginalAddon: true
            });
            continue;
        }
        
        // Special handling for paid Kickstarter backer pledges (already paid, price is $0)
        if (item.isPaidKickstarterPledge) {
            validatedItems.push({
                id: item.id || 'ks-pledge',
                name: item.name,
                price: 0,
                quantity: 1,
                subtotal: 0,
                isPaidKickstarterPledge: true
            });
            // No cost added to serverTotal since it's already paid
            continue;
        }
        
        // Fetch actual price from database
        // Handle prefixed IDs (e.g., 'pledge-4', 'addon-4') for collision avoidance
        let dbItem = null;
        let dbId = item.db_id || item.id;  // Use db_id if available, otherwise use id
        let source = item.source || null;
        
        // Parse prefixed ID if it's a string like 'pledge-4' or 'addon-4'
        if (typeof dbId === 'string') {
            if (dbId.startsWith('pledge-')) {
                source = 'products';
                dbId = parseInt(dbId.replace('pledge-', ''), 10);
            } else if (dbId.startsWith('addon-')) {
                source = 'addons';
                dbId = parseInt(dbId.replace('addon-', ''), 10);
            }
        }
        
        // Query the appropriate table based on source
        if (source === 'products') {
            try {
                dbItem = await queryOne('SELECT * FROM products WHERE id = $1 AND active = 1', [dbId]);
            } catch (err) {
                console.error('Error fetching from products:', err);
            }
        } else if (source === 'addons') {
            try {
                dbItem = await queryOne('SELECT * FROM addons WHERE id = $1 AND active = 1', [dbId]);
            } catch (err) {
                console.error('Error fetching from addons:', err);
            }
        } else {
            // Fallback: try products table first (pledges), then addons
            try {
                dbItem = await queryOne('SELECT * FROM products WHERE id = $1 AND active = 1', [dbId]);
            } catch (err) {
                // Products table might not exist
            }
            
            if (!dbItem) {
                try {
                    dbItem = await queryOne('SELECT * FROM addons WHERE id = $1 AND active = 1', [dbId]);
                } catch (err) {
                    console.error('Error fetching item from database:', err);
                }
            }
        }
        
        if (!dbItem) {
            throw new Error(`Item ${item.name} not found in database`);
        }
        
        // Determine correct price based on backer status
        let correctPrice = dbItem.price;
        if (isBacker && dbItem.backer_price !== null && dbItem.backer_price !== undefined) {
            correctPrice = dbItem.backer_price;
        }
        
        // Calculate item total
        const quantity = parseInt(item.quantity) || 1;
        const itemTotal = correctPrice * quantity;
        serverTotal += itemTotal;
        
        validatedItems.push({
            id: dbItem.id,
            name: dbItem.name,
            price: correctPrice,
            quantity: quantity,
            subtotal: itemTotal
        });
    }
    
    return { serverTotal, validatedItems };
}

// Check if a user is an actual Kickstarter backer (not just a logged-in guest)
function isBacker(user) {
    if (!user) return false;
    // A backer has a backer_number OR pledge_amount OR reward_title from Kickstarter
    return !!(user.backer_number || user.pledge_amount || user.reward_title);
}

// Eligible backer = backer AND not dropped (Kickstarter payment failed)
function isEligibleBacker(user) {
    if (!isBacker(user)) return false;
    return String(user?.pledged_status || '').toLowerCase() !== 'dropped';
}

// Dropped backer = backer AND dropped (Kickstarter payment failed)
function isDroppedBacker(user) {
    if (!isBacker(user)) return false;
    return String(user?.pledged_status || '').toLowerCase() === 'dropped';
}

// Check if user is a dropped backer by querying the database
async function isDroppedBackerByUserId(userId) {
    if (!userId) return false;
    try {
        const user = await queryOne(
            'SELECT backer_number, pledge_amount, reward_title, pledged_status FROM users WHERE id = $1',
            [userId]
        );
        return isDroppedBacker(user);
    } catch (err) {
        console.error('Error checking if user is dropped backer:', err);
        return false;
    }
}

// Check if user is a backer from session data (fallback, not reliable)
function isBackerFromSession(session) {
    if (!session || !session.userId) return false;
    return !!(session.backerNumber || session.pledgeAmount || session.rewardTitle);
}

// Check if user is a backer by querying the database (reliable)
async function isBackerByUserId(userId) {
    if (!userId) return false;
    try {
        const user = await queryOne('SELECT backer_number, pledge_amount, reward_title FROM users WHERE id = $1', [userId]);
        if (!user) return false;
        // A backer has a backer_number OR pledge_amount OR reward_title from Kickstarter
        return !!(user.backer_number || user.pledge_amount || user.reward_title);
    } catch (err) {
        console.error('Error checking if user is backer:', err);
        return false;
    }
}

async function isEligibleBackerByUserId(userId) {
    if (!userId) return false;
    try {
        const user = await queryOne(
            'SELECT backer_number, pledge_amount, reward_title, pledged_status FROM users WHERE id = $1',
            [userId]
        );
        return isEligibleBacker(user);
    } catch (err) {
        console.error('Error checking if user is eligible backer:', err);
        return false;
    }
}

// Customer = eligible backer OR has made a payment on the platform
// Sync version - only checks backer status (can't check orders without async DB call)
function isCustomer(user) {
    return isEligibleBacker(user);
}

// Async version - checks both backer status AND paid orders in DB
async function isCustomerByUserId(userId) {
    if (!userId) return false;
    try {
        // First check: is eligible backer?
        if (await isEligibleBackerByUserId(userId)) return true;
        
        // Second check: has at least one paid order or card saved?
        const paidOrder = await queryOne(
            `SELECT id FROM orders WHERE user_id = $1 AND (paid = 1 OR payment_status = 'card_saved') LIMIT 1`,
            [userId]
        );
        return !!paidOrder;
    } catch (err) {
        console.error('Error checking if user is customer:', err);
        return false;
    }
}

// Check if user is a late pledge backer (backed after campaign ended - pays retail prices)
async function isLatePledgeByUserId(userId) {
    if (!userId) return false;
    try {
        const user = await queryOne('SELECT is_late_pledge FROM users WHERE id = $1', [userId]);
        return user && user.is_late_pledge === 1;
    } catch (err) {
        console.error('Error checking if user is late pledge:', err);
        return false;
    }
}

module.exports = {
    // Constants
    OTP_TTL_MS,
    MAGIC_TTL_MS,
    LOGIN_STALE_DAYS,
    PIN_LOGIN_GRACE_DAYS,
    
    // Auth helpers
    generateOtpCode,
    generateOtp,
    generateMagicToken,
    generateRandomPassword,
    isLoginStale,
    isLoginStaleByDate,
    needsOtp,
    updateLastLogin,
    
    // User helpers
    getUserByEmail,
    createShadowUser,
    ensureUserByEmail,
    findOrCreateShadowUser,
    isBacker,
    isEligibleBacker,
    isDroppedBacker,
    isDroppedBackerByUserId,
    isBackerFromSession,
    isBackerByUserId,
    isEligibleBackerByUserId,
    isCustomer,
    isCustomerByUserId,
    
    // Email helpers
    logEmail,
    
    // Shipping & pricing
    calculateShipping,
    validateCartPrices
};

