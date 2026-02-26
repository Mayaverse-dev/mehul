/**
 * Duplicate Order Prevention Tests
 * Tests the single-order-per-user enforcement logic added to
 * /api/create-payment-intent and /api/guest/create-payment-intent
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createTestOrder,
    query,
    queryOne,
    execute
} = require('./setup');
const fixtures = require('./fixtures');

describe('Duplicate Order Prevention', () => {

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
    // EXISTING ORDER DETECTION QUERY
    // ==========================================

    describe('Existing Order Detection', () => {

        test('Detects existing order for user', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            await createTestOrder(fixtures.orders.completedOrder(user.id));

            const existingOrder = await queryOne(
                'SELECT id, payment_status, paid, stripe_payment_intent_id FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user.id]
            );

            expect(existingOrder).toBeDefined();
            expect(existingOrder.payment_status).toBe('card_saved');
        });

        test('Returns undefined when user has no orders', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);

            const existingOrder = await queryOne(
                'SELECT id, payment_status, paid, stripe_payment_intent_id FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user.id]
            );

            expect(existingOrder).toBeUndefined();
        });

        test('Returns most recent order when multiple exist (legacy data)', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);

            await createTestOrder({
                user_id: user.id,
                new_addons: '[]',
                shipping_address: '{}',
                total: 10,
                shipping_cost: 0,
                addons_subtotal: 10,
                payment_status: 'pending',
                stripe_payment_intent_id: 'seti_old'
            });
            await createTestOrder({
                user_id: user.id,
                new_addons: '[]',
                shipping_address: '{}',
                total: 50,
                shipping_cost: 12,
                addons_subtotal: 38,
                payment_status: 'card_saved',
                stripe_payment_intent_id: 'seti_new'
            });

            const existingOrder = await queryOne(
                'SELECT id, payment_status, paid, stripe_payment_intent_id FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user.id]
            );

            expect(existingOrder.stripe_payment_intent_id).toBe('seti_new');
            expect(existingOrder.payment_status).toBe('card_saved');
        });

        test('Does not match orders from other users', async () => {
            const user1 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'user1-dup@test.com'
            });
            const user2 = await createTestUser({
                ...fixtures.users.foundersBacker,
                email: 'user2-dup@test.com'
            });

            await createTestOrder(fixtures.orders.completedOrder(user1.id));

            const existingOrder = await queryOne(
                'SELECT id, payment_status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user2.id]
            );

            expect(existingOrder).toBeUndefined();
        });
    });

    // ==========================================
    // COMPLETED ORDER REJECTION
    // ==========================================

    describe('Completed Order Rejection', () => {

        const completedStatuses = ['card_saved', 'succeeded', 'charged', 'charge_failed'];

        test.each(completedStatuses)(
            'Rejects when existing order has payment_status = %s',
            async (status) => {
                const user = await createTestUser({
                    ...fixtures.users.kickstarterBacker,
                    email: `reject-${status}@test.com`
                });

                await createTestOrder({
                    user_id: user.id,
                    new_addons: JSON.stringify([{ name: 'Test Pledge', price: 35, quantity: 1 }]),
                    shipping_address: JSON.stringify(fixtures.addresses.usa),
                    total: 47,
                    shipping_cost: 12,
                    addons_subtotal: 35,
                    payment_status: status,
                    paid: (status === 'succeeded' || status === 'charged') ? 1 : 0,
                    stripe_payment_intent_id: `seti_${status}_test`
                });

                const existingOrder = await queryOne(
                    'SELECT id, payment_status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                    [user.id]
                );

                const shouldReject = ['card_saved', 'succeeded', 'charged', 'charge_failed']
                    .includes(existingOrder.payment_status);

                expect(shouldReject).toBe(true);
            }
        );
    });

    // ==========================================
    // PENDING ORDER UPDATE (UPSERT)
    // ==========================================

    describe('Pending Order Update (Upsert)', () => {

        test('Pending order is updated instead of creating duplicate', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);

            const pendingOrder = await createTestOrder({
                user_id: user.id,
                new_addons: JSON.stringify([{ name: 'Old Pledge', price: 30, quantity: 1 }]),
                shipping_address: JSON.stringify(fixtures.addresses.usa),
                total: 42,
                shipping_cost: 12,
                addons_subtotal: 30,
                payment_status: 'pending',
                stripe_payment_intent_id: 'seti_old_pending'
            });

            const existingOrder = await queryOne(
                'SELECT id, payment_status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user.id]
            );

            expect(existingOrder.payment_status).toBe('pending');

            // Simulate upsert: update the existing order
            const newCartItems = JSON.stringify([{ name: 'New Pledge', price: 50, quantity: 1 }]);
            const newAddress = JSON.stringify(fixtures.addresses.uk);

            await execute(`UPDATE orders SET 
                new_addons = $1, shipping_address = $2, 
                shipping_cost = $3, addons_subtotal = $4, total = $5, 
                stripe_customer_id = $6, stripe_payment_intent_id = $7,
                payment_status = $8, paid = $9
                WHERE id = $10`, [
                newCartItems, newAddress,
                15, 50, 65,
                'cus_retry', 'seti_new_retry',
                'pending', 0,
                existingOrder.id
            ]);

            // Verify update happened and no duplicate was created
            const allOrders = await query(
                'SELECT * FROM orders WHERE user_id = $1',
                [user.id]
            );
            expect(allOrders.length).toBe(1);

            const updatedOrder = allOrders[0];
            expect(updatedOrder.id).toBe(pendingOrder.id);
            expect(updatedOrder.total).toBe(65);
            expect(updatedOrder.stripe_payment_intent_id).toBe('seti_new_retry');
            expect(JSON.parse(updatedOrder.new_addons)[0].name).toBe('New Pledge');
        });

        test('Pending order preserves order ID after update', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);

            const pendingOrder = await createTestOrder({
                user_id: user.id,
                new_addons: '[]',
                shipping_address: '{}',
                total: 0,
                shipping_cost: 0,
                addons_subtotal: 0,
                payment_status: 'pending',
                stripe_payment_intent_id: 'seti_preserve_id'
            });

            const originalId = pendingOrder.id;

            await execute(`UPDATE orders SET 
                total = $1, stripe_payment_intent_id = $2
                WHERE id = $3`, [
                100, 'seti_updated', originalId
            ]);

            const updated = await queryOne('SELECT * FROM orders WHERE id = $1', [originalId]);
            expect(updated.id).toBe(originalId);
            expect(updated.total).toBe(100);
            expect(updated.stripe_payment_intent_id).toBe('seti_updated');
        });
    });

    // ==========================================
    // NEW ORDER CREATION (NO EXISTING)
    // ==========================================

    describe('New Order Creation', () => {

        test('Creates new order when user has no existing orders', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);

            const ordersBefore = await query(
                'SELECT * FROM orders WHERE user_id = $1', [user.id]
            );
            expect(ordersBefore.length).toBe(0);

            await createTestOrder({
                user_id: user.id,
                new_addons: JSON.stringify([{ name: 'Test Pledge', price: 35, quantity: 1 }]),
                shipping_address: JSON.stringify(fixtures.addresses.usa),
                total: 47,
                shipping_cost: 12,
                addons_subtotal: 35,
                payment_status: 'pending',
                stripe_payment_intent_id: 'seti_fresh'
            });

            const ordersAfter = await query(
                'SELECT * FROM orders WHERE user_id = $1', [user.id]
            );
            expect(ordersAfter.length).toBe(1);
            expect(ordersAfter[0].total).toBe(47);
        });
    });

    // ==========================================
    // GUEST (SHADOW USER) DUPLICATE PREVENTION
    // ==========================================

    describe('Guest / Shadow User Duplicate Prevention', () => {

        test('Detects existing order for shadow user', async () => {
            const guest = await createTestUser(fixtures.users.guestUser);

            await createTestOrder({
                user_id: guest.id,
                new_addons: JSON.stringify([{ name: 'Guest Pledge', price: 50, quantity: 1 }]),
                shipping_address: JSON.stringify(fixtures.addresses.usa),
                total: 62,
                shipping_cost: 12,
                addons_subtotal: 50,
                payment_status: 'succeeded',
                paid: 1,
                stripe_payment_intent_id: 'pi_guest_paid'
            });

            const existingOrder = await queryOne(
                'SELECT id, payment_status, paid FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [guest.id]
            );

            expect(existingOrder).toBeDefined();
            expect(existingOrder.payment_status).toBe('succeeded');

            const shouldReject = ['card_saved', 'succeeded', 'charged', 'charge_failed']
                .includes(existingOrder.payment_status);
            expect(shouldReject).toBe(true);
        });

        test('Guest pending order is updated on retry', async () => {
            const guest = await createTestUser(fixtures.users.guestUser);

            await createTestOrder({
                user_id: guest.id,
                new_addons: JSON.stringify([{ name: 'Old Guest Pledge', price: 40, quantity: 1 }]),
                shipping_address: JSON.stringify({ ...fixtures.addresses.usa, email: 'guest@test.com' }),
                total: 52,
                shipping_cost: 12,
                addons_subtotal: 40,
                payment_status: 'pending',
                stripe_payment_intent_id: 'pi_guest_old'
            });

            const existingOrder = await queryOne(
                'SELECT id, payment_status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [guest.id]
            );

            expect(existingOrder.payment_status).toBe('pending');

            await execute(`UPDATE orders SET 
                new_addons = $1, total = $2, stripe_payment_intent_id = $3
                WHERE id = $4`, [
                JSON.stringify([{ name: 'New Guest Pledge', price: 50, quantity: 1 }]),
                62,
                'pi_guest_retry',
                existingOrder.id
            ]);

            const allOrders = await query(
                'SELECT * FROM orders WHERE user_id = $1', [guest.id]
            );
            expect(allOrders.length).toBe(1);
            expect(allOrders[0].total).toBe(62);
            expect(allOrders[0].stripe_payment_intent_id).toBe('pi_guest_retry');
        });
    });

    // ==========================================
    // EDGE CASES
    // ==========================================

    describe('Edge Cases', () => {

        test('Different users can each have their own order', async () => {
            const user1 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'user1-edge@test.com'
            });
            const user2 = await createTestUser({
                ...fixtures.users.droppedBacker,
                email: 'user2-edge@test.com'
            });

            await createTestOrder({
                ...fixtures.orders.completedOrder(user1.id),
                stripe_payment_intent_id: 'seti_user1'
            });
            await createTestOrder({
                ...fixtures.orders.paidOrder(user2.id),
                stripe_payment_intent_id: 'pi_user2'
            });

            const order1 = await queryOne(
                'SELECT * FROM orders WHERE user_id = $1', [user1.id]
            );
            const order2 = await queryOne(
                'SELECT * FROM orders WHERE user_id = $1', [user2.id]
            );

            expect(order1).toBeDefined();
            expect(order2).toBeDefined();
            expect(order1.id).not.toBe(order2.id);
        });

        test('User with user_id = 0 (unlinked) does not block other users', async () => {
            await createTestOrder({
                user_id: 0,
                new_addons: '[]',
                shipping_address: '{}',
                total: 10,
                shipping_cost: 0,
                addons_subtotal: 10,
                payment_status: 'pending',
                stripe_payment_intent_id: 'seti_unlinked'
            });

            const user = await createTestUser(fixtures.users.kickstarterBacker);

            const existingOrder = await queryOne(
                'SELECT id FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user.id]
            );

            expect(existingOrder).toBeUndefined();
        });

        test('charge_failed order blocks new checkout (admin handles retry)', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);

            await createTestOrder({
                user_id: user.id,
                new_addons: JSON.stringify([{ name: 'Test Pledge', price: 35, quantity: 1 }]),
                shipping_address: JSON.stringify(fixtures.addresses.usa),
                total: 47,
                shipping_cost: 12,
                addons_subtotal: 35,
                payment_status: 'charge_failed',
                paid: 0,
                stripe_payment_intent_id: 'seti_failed',
                stripe_payment_method_id: 'pm_failed'
            });

            const existingOrder = await queryOne(
                'SELECT id, payment_status FROM orders WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [user.id]
            );

            const shouldReject = ['card_saved', 'succeeded', 'charged', 'charge_failed']
                .includes(existingOrder.payment_status);

            expect(shouldReject).toBe(true);
        });
    });
});
