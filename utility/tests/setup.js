/**
 * Test Setup & Utilities
 * Provides test database, app instance, and helper functions
 */

const path = require('path');

// Set test environment before requiring app modules
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_key';

// Use in-memory SQLite for tests
delete process.env.DATABASE_URL;

const bcrypt = require('bcrypt');

// Database module - will use SQLite in test mode
const { query, queryOne, execute, initConnection, closeConnections } = require('../../config/database');

/**
 * Initialize test database with clean tables
 */
async function setupTestDatabase() {
    // Initialize connection (SQLite for tests)
    initConnection();
    
    // Wait a bit for SQLite to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Clean all test data between tests
 */
async function cleanDatabase() {
    try {
        await execute('DELETE FROM email_logs');
        await execute('DELETE FROM orders');
        await execute('DELETE FROM ebook_download_events');
        await execute('DELETE FROM users WHERE email LIKE $1', ['%@test.com']);
        await execute('DELETE FROM addons WHERE name LIKE $1', ['Test%']);
        await execute('DELETE FROM products WHERE name LIKE $1', ['Test%']);
    } catch (err) {
        // Tables might not exist yet, ignore
    }
}

/**
 * Close database connections
 */
async function teardownTestDatabase() {
    await closeConnections();
}

/**
 * Create a test user with specified attributes
 */
async function createTestUser(userData) {
    const defaults = {
        email: `test-${Date.now()}@test.com`,
        password: await bcrypt.hash('testpassword', 10),
        backer_number: null,
        backer_name: null,
        reward_title: null,
        pledge_amount: null,
        kickstarter_items: null,
        kickstarter_addons: null,
        pledged_status: null,
        is_late_pledge: 0,
        amount_due: null,
        amount_paid: null,
        pin_hash: null
    };

    const user = { ...defaults, ...userData };
    
    // Hash PIN if provided as plain text
    if (userData.pin && !userData.pin_hash) {
        user.pin_hash = await bcrypt.hash(userData.pin, 10);
    }

    await execute(`
        INSERT INTO users (
            email, password, backer_number, backer_name, reward_title, 
            pledge_amount, kickstarter_items, kickstarter_addons,
            pledged_status, is_late_pledge, amount_due, amount_paid, pin_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
        user.email, user.password, user.backer_number, user.backer_name,
        user.reward_title, user.pledge_amount, user.kickstarter_items,
        user.kickstarter_addons, user.pledged_status, user.is_late_pledge,
        user.amount_due, user.amount_paid, user.pin_hash
    ]);

    return await queryOne('SELECT * FROM users WHERE email = $1', [user.email]);
}

/**
 * Create a test product (pledge tier)
 */
async function createTestProduct(productData) {
    const defaults = {
        name: `Test Pledge ${Date.now()}`,
        type: 'pledge',
        price: 100,
        backer_price: 80,
        weight: 500,
        image: 'test-image.png',
        active: 1,
        description: 'Test product description'
    };

    const product = { ...defaults, ...productData };

    await execute(`
        INSERT INTO products (name, type, price, backer_price, weight, image, active, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
        product.name, product.type, product.price, product.backer_price,
        product.weight, product.image, product.active, product.description
    ]);

    return await queryOne('SELECT * FROM products WHERE name = $1', [product.name]);
}

/**
 * Create a test addon
 */
async function createTestAddon(addonData) {
    const defaults = {
        name: `Test Addon ${Date.now()}`,
        price: 25,
        backer_price: 20,
        weight: 100,
        image: 'test-addon.png',
        active: 1,
        description: 'Test addon description'
    };

    const addon = { ...defaults, ...addonData };

    await execute(`
        INSERT INTO addons (name, price, backer_price, weight, image, active, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
        addon.name, addon.price, addon.backer_price,
        addon.weight, addon.image, addon.active, addon.description
    ]);

    return await queryOne('SELECT * FROM addons WHERE name = $1', [addon.name]);
}

/**
 * Create a test order
 */
async function createTestOrder(orderData) {
    const defaults = {
        user_id: 0,
        new_addons: '[]',
        shipping_address: '{}',
        shipping_cost: 0,
        addons_subtotal: 0,
        total: 0,
        stripe_customer_id: null,
        stripe_payment_intent_id: null,
        stripe_payment_method_id: null,
        payment_status: 'pending',
        paid: 0
    };

    const order = { ...defaults, ...orderData };

    await execute(`
        INSERT INTO orders (
            user_id, new_addons, shipping_address, shipping_cost, 
            addons_subtotal, total, stripe_customer_id, stripe_payment_intent_id,
            stripe_payment_method_id, payment_status, paid
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
        order.user_id, order.new_addons, order.shipping_address,
        order.shipping_cost, order.addons_subtotal, order.total,
        order.stripe_customer_id, order.stripe_payment_intent_id,
        order.stripe_payment_method_id, order.payment_status, order.paid
    ]);

    return await queryOne('SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [order.user_id]);
}

/**
 * Mock session for testing authenticated routes
 */
function createMockSession(user) {
    return {
        userId: user.id,
        userEmail: user.email,
        backerNumber: user.backer_number,
        backerName: user.backer_name,
        pledgeAmount: user.pledge_amount,
        rewardTitle: user.reward_title
    };
}

module.exports = {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createTestProduct,
    createTestAddon,
    createTestOrder,
    createMockSession,
    query,
    queryOne,
    execute
};
