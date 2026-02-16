/**
 * Orders Tests
 * Tests for completed order display, order summary
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createTestOrder,
    queryOne
} = require('./setup');
const fixtures = require('./fixtures');

describe('Orders - Order Display & Summary', () => {
    
    beforeAll(async () => {
        await setupTestDatabase();
    });

    afterAll(async () => {
        await teardownTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
    });

    // ==========================================
    // COMPLETED ORDER STATE TESTS
    // ==========================================
    
    describe('Completed Order State', () => {
        
        test('User with completed order has hasCompletedOrder = true', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id, user.email);
            await createTestOrder(orderData);
            
            // Query like the API does
            const order = await queryOne(`
                SELECT * FROM orders 
                WHERE user_id = $1 
                  AND shipping_address IS NOT NULL 
                  AND shipping_address != '{}'
                  AND (
                      stripe_payment_method_id IS NOT NULL 
                      OR payment_status IN ('card_saved', 'succeeded')
                  )
                ORDER BY created_at DESC 
                LIMIT 1
            `, [user.id]);
            
            expect(order).not.toBeNull();
            expect(order.user_id).toBe(user.id);
        });

        test('User without order has no completed order', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            const order = await queryOne(`
                SELECT * FROM orders 
                WHERE user_id = $1 
                  AND shipping_address IS NOT NULL 
                  AND stripe_payment_method_id IS NOT NULL
                ORDER BY created_at DESC 
                LIMIT 1
            `, [user.id]);
            
            expect(order).toBeUndefined();
        });

        test('Order items parse correctly from JSON', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            const items = JSON.parse(order.new_addons);
            
            expect(Array.isArray(items)).toBe(true);
            expect(items.length).toBe(2);
            expect(items[0].name).toBe('Test Humble Vaanar');
            expect(items[0].price).toBe(35);
            expect(items[1].name).toBe('Test MAYA Bookmark');
            expect(items[1].quantity).toBe(2);
        });

        test('Shipping address parses correctly from JSON', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            const address = JSON.parse(order.shipping_address);
            
            expect(address.fullName).toBe('Test User');
            expect(address.city).toBe('Test City');
            expect(address.country).toBe('United States');
        });

        test('Order totals are correct', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            expect(order.addons_subtotal).toBe(59);
            expect(order.shipping_cost).toBe(12);
            expect(order.total).toBe(71);
            expect(order.total).toBe(order.addons_subtotal + order.shipping_cost);
        });
    });

    // ==========================================
    // ORDER PAYMENT STATUS TESTS
    // ==========================================
    
    describe('Order Payment Status', () => {
        
        test('Card saved order has payment_status = card_saved', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            expect(order.payment_status).toBe('card_saved');
            expect(order.paid).toBe(0);
        });

        test('Paid order has payment_status = succeeded', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.paidOrder(user.id);
            const order = await createTestOrder(orderData);
            
            expect(order.payment_status).toBe('succeeded');
            expect(order.paid).toBe(1);
        });

        test('Stripe IDs are stored correctly', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            expect(order.stripe_customer_id).toBe('cus_test123');
            expect(order.stripe_payment_intent_id).toBe('seti_test123');
            expect(order.stripe_payment_method_id).toBe('pm_test123');
        });
    });

    // ==========================================
    // ORDER SUMMARY FOR THANK YOU PAGE
    // ==========================================
    
    describe('Order Summary Display', () => {
        
        test('Order summary contains all required fields', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            // These are the fields needed for thank you page
            expect(order.id).toBeDefined();
            expect(order.total).toBeDefined();
            expect(order.shipping_cost).toBeDefined();
            expect(order.addons_subtotal).toBeDefined();
            expect(order.shipping_address).toBeDefined();
            expect(order.new_addons).toBeDefined();
            expect(order.payment_status).toBeDefined();
            expect(order.created_at).toBeDefined();
        });

        test('Order can be retrieved by Stripe Intent ID', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            await createTestOrder(orderData);
            
            const order = await queryOne(
                'SELECT * FROM orders WHERE stripe_payment_intent_id = $1',
                ['seti_test123']
            );
            
            expect(order).not.toBeNull();
            expect(order.user_id).toBe(user.id);
        });

        test('Null/empty JSON fields handled gracefully', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = {
                user_id: user.id,
                new_addons: null,
                shipping_address: '{}',
                total: 0,
                shipping_cost: 0,
                addons_subtotal: 0,
                payment_status: 'pending'
            };
            const order = await createTestOrder(orderData);
            
            // Should not throw when parsing
            const items = order.new_addons ? JSON.parse(order.new_addons) : [];
            const address = JSON.parse(order.shipping_address || '{}');
            
            expect(Array.isArray(items)).toBe(true);
            expect(items.length).toBe(0);
            expect(typeof address).toBe('object');
        });
    });

    // ==========================================
    // ORDER OWNERSHIP TESTS
    // ==========================================
    
    describe('Order Ownership', () => {
        
        test('Order belongs to correct user', async () => {
            const user1 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'user1-order@test.com'
            });
            const user2 = await createTestUser({
                ...fixtures.users.foundersBacker,
                email: 'user2-order@test.com'
            });
            
            const orderData = fixtures.orders.completedOrder(user1.id);
            const order = await createTestOrder(orderData);
            
            expect(order.user_id).toBe(user1.id);
            expect(order.user_id).not.toBe(user2.id);
        });

        test('Query by wrong user returns no order', async () => {
            const user1 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'owner@test.com'
            });
            const user2 = await createTestUser({
                ...fixtures.users.guestUser,
                email: 'other@test.com'
            });
            
            const orderData = fixtures.orders.completedOrder(user1.id);
            await createTestOrder(orderData);
            
            // Query with wrong user ID
            const wrongOrder = await queryOne(
                'SELECT * FROM orders WHERE user_id = $1',
                [user2.id]
            );
            
            expect(wrongOrder).toBeUndefined();
        });

        test('User can have multiple orders', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            await createTestOrder(fixtures.orders.completedOrder(user.id));
            await createTestOrder(fixtures.orders.paidOrder(user.id));
            
            const orders = await queryOne(
                'SELECT COUNT(*) as count FROM orders WHERE user_id = $1',
                [user.id]
            );
            
            expect(parseInt(orders.count)).toBe(2);
        });
    });

    // ==========================================
    // SHIPPING ADDRESS UPDATE TESTS
    // ==========================================
    
    describe('Shipping Address Update', () => {
        
        test('Shipping address can be updated', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            const newAddress = {
                fullName: 'Updated Name',
                addressLine1: '999 New Street',
                city: 'New City',
                state: 'NC',
                postalCode: '99999',
                country: 'Canada'
            };
            
            // Simulate update
            const { execute } = require('./setup');
            await execute(
                'UPDATE orders SET shipping_address = $1 WHERE id = $2',
                [JSON.stringify(newAddress), order.id]
            );
            
            const updatedOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id]);
            const updatedAddress = JSON.parse(updatedOrder.shipping_address);
            
            expect(updatedAddress.fullName).toBe('Updated Name');
            expect(updatedAddress.city).toBe('New City');
            expect(updatedAddress.country).toBe('Canada');
        });

        test('Shipping cost remains unchanged when address updated', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const orderData = fixtures.orders.completedOrder(user.id);
            const order = await createTestOrder(orderData);
            
            const originalShippingCost = order.shipping_cost;
            
            // Update address only
            const newAddress = { ...fixtures.addresses.uk };
            const { execute } = require('./setup');
            await execute(
                'UPDATE orders SET shipping_address = $1 WHERE id = $2',
                [JSON.stringify(newAddress), order.id]
            );
            
            const updatedOrder = await queryOne('SELECT * FROM orders WHERE id = $1', [order.id]);
            
            // Shipping cost should not change (intentional behavior)
            expect(updatedOrder.shipping_cost).toBe(originalShippingCost);
        });
    });
});
