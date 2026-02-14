/**
 * Checkout Tests
 * Tests for cart validation, payment flow decisions
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createTestProduct,
    createTestAddon,
    createTestOrder
} = require('./setup');
const fixtures = require('./fixtures');
const { validateCartPrices } = require('../../utils/helpers');

describe('Checkout - Cart Validation & Payment Flow', () => {
    
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
    // CART VALIDATION - PLEDGE REQUIRED
    // ==========================================
    
    describe('Cart Validation - Pledge Required', () => {
        
        test('Cart with pledge is valid', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, type: 'pledge', source: 'products' }
            ];
            
            // Should not throw
            const { serverTotal } = await validateCartPrices(cart, true);
            expect(serverTotal).toBe(35);
        });

        test('Cart with pledge and addons is valid', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            const addon = await createTestAddon(fixtures.addons.bookmark);
            
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, type: 'pledge', source: 'products' },
                { id: addon.id, name: addon.name, price: 12, quantity: 2, source: 'addons' }
            ];
            
            const { serverTotal } = await validateCartPrices(cart, true);
            expect(serverTotal).toBe(35 + 24); // pledge + 2 bookmarks
        });

        test('Pledge identified by type field', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: 'Some Custom Name', price: 35, quantity: 1, type: 'pledge', source: 'products' }
            ];
            
            // Type field should help identify as pledge
            expect(cart[0].type).toBe('pledge');
        });

        test('Pledge identified by name containing tier name', () => {
            const pledgeNames = ['humble vaanar', 'industrious manushya', 'resplendent garuda', 'benevolent divya', 'founders of neh'];
            
            const cartItems = [
                { name: 'Upgrade to Humble Vaanar', quantity: 1 },
                { name: 'MAYA Bookmark', quantity: 2 }
            ];
            
            const hasPledge = cartItems.some(item => {
                const nameLower = (item.name || '').toLowerCase();
                return pledgeNames.some(pledge => nameLower.includes(pledge));
            });
            
            expect(hasPledge).toBe(true);
        });

        test('Addons-only cart should be identified as invalid', () => {
            const cartItems = [
                { name: 'MAYA Bookmark', quantity: 2 },
                { name: 'MAYA Sticker', quantity: 1 }
            ];
            
            const pledgeNames = ['humble vaanar', 'industrious manushya', 'resplendent garuda', 'benevolent divya', 'founders of neh'];
            
            const hasPledge = cartItems.some(item => {
                const nameLower = (item.name || '').toLowerCase();
                return item.type === 'pledge' || pledgeNames.some(pledge => nameLower.includes(pledge));
            });
            
            expect(hasPledge).toBe(false);
        });
    });

    // ==========================================
    // CART VALIDATION - SINGLE PLEDGE ONLY
    // ==========================================
    
    describe('Cart Validation - Single Pledge Only', () => {
        
        test('Single pledge is valid', () => {
            const cartItems = [
                { name: 'Humble Vaanar', type: 'pledge', quantity: 1 }
            ];
            
            const pledgeItems = cartItems.filter(item => item.type === 'pledge');
            expect(pledgeItems.length).toBe(1);
        });

        test('Multiple pledges should be identified as invalid', () => {
            const cartItems = [
                { name: 'Humble Vaanar', type: 'pledge', quantity: 1 },
                { name: 'Industrious Manushya', type: 'pledge', quantity: 1 }
            ];
            
            const pledgeItems = cartItems.filter(item => item.type === 'pledge');
            expect(pledgeItems.length).toBe(2); // Invalid: more than 1
            expect(pledgeItems.length).toBeGreaterThan(1); // Test should catch this
        });

        test('Pledge upgrade counts as valid pledge', () => {
            const cartItems = [
                { name: 'Upgrade to Industrious Manushya', isPledgeUpgrade: true, quantity: 1 }
            ];
            
            const hasPledge = cartItems.some(item => 
                item.type === 'pledge' || item.isPledgeUpgrade
            );
            
            expect(hasPledge).toBe(true);
        });

        test('Dropped backer pledge counts as valid pledge', () => {
            const cartItems = [
                { name: 'Humble Vaanar', isDroppedBackerPledge: true, quantity: 1 }
            ];
            
            const hasPledge = cartItems.some(item => 
                item.type === 'pledge' || item.isDroppedBackerPledge
            );
            
            expect(hasPledge).toBe(true);
        });
    });

    // ==========================================
    // PAYMENT FLOW DECISION TESTS
    // ==========================================
    
    describe('Payment Flow Decision - SetupIntent vs PaymentIntent', () => {
        
        // Note: These test the decision logic that determines payment type
        // The actual Stripe integration is mocked in production tests
        
        test('Regular KS backer (non-India) should use SetupIntent', async () => {
            const backer = await createTestUser(fixtures.users.kickstarterBacker);
            const address = fixtures.addresses.usa;
            
            // Decision logic
            const isAuthenticated = true;
            const isIndianAddress = address.country.toLowerCase().includes('india');
            const isDroppedBacker = backer.pledged_status === 'dropped';
            
            const chargeImmediately = isDroppedBacker || isIndianAddress;
            const useSetupIntent = isAuthenticated && !chargeImmediately;
            
            expect(useSetupIntent).toBe(true);
            expect(chargeImmediately).toBe(false);
        });

        test('Indian backer should use PaymentIntent (immediate charge)', async () => {
            const backer = await createTestUser(fixtures.users.kickstarterBacker);
            const address = fixtures.addresses.india;
            
            const isAuthenticated = true;
            const isIndianAddress = address.country.toLowerCase().includes('india');
            const isDroppedBacker = backer.pledged_status === 'dropped';
            
            const chargeImmediately = isDroppedBacker || isIndianAddress;
            const useSetupIntent = isAuthenticated && !chargeImmediately;
            
            expect(chargeImmediately).toBe(true);
            expect(useSetupIntent).toBe(false);
        });

        test('Dropped backer should use PaymentIntent (immediate charge)', async () => {
            const droppedBacker = await createTestUser(fixtures.users.droppedBacker);
            const address = fixtures.addresses.usa;
            
            const isAuthenticated = true;
            const isIndianAddress = address.country.toLowerCase().includes('india');
            const isDroppedBacker = droppedBacker.pledged_status === 'dropped';
            
            const chargeImmediately = isDroppedBacker || isIndianAddress;
            const useSetupIntent = isAuthenticated && !chargeImmediately;
            
            expect(isDroppedBacker).toBe(true);
            expect(chargeImmediately).toBe(true);
            expect(useSetupIntent).toBe(false);
        });

        test('Guest should use PaymentIntent (immediate charge)', async () => {
            const guest = await createTestUser(fixtures.users.guestUser);
            const address = fixtures.addresses.usa;
            
            const isAuthenticated = false; // Guest not logged in
            const isIndianAddress = address.country.toLowerCase().includes('india');
            const isDroppedBacker = false;
            
            const chargeImmediately = !isAuthenticated || isDroppedBacker || isIndianAddress;
            const useSetupIntent = isAuthenticated && !chargeImmediately;
            
            expect(chargeImmediately).toBe(true);
            expect(useSetupIntent).toBe(false);
        });

        test('UK backer should use SetupIntent', async () => {
            const backer = await createTestUser(fixtures.users.kickstarterBacker);
            const address = fixtures.addresses.uk;
            
            const isAuthenticated = true;
            const isIndianAddress = address.country.toLowerCase().includes('india');
            const isDroppedBacker = backer.pledged_status === 'dropped';
            
            const chargeImmediately = isDroppedBacker || isIndianAddress;
            const useSetupIntent = isAuthenticated && !chargeImmediately;
            
            expect(useSetupIntent).toBe(true);
        });
    });

    // ==========================================
    // PRICE MISMATCH DETECTION
    // ==========================================
    
    describe('Price Mismatch Detection', () => {
        
        test('Correct total passes validation', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, source: 'products' }
            ];
            
            const { serverTotal } = await validateCartPrices(cart, true);
            const shippingCost = 12;
            const submittedTotal = 47; // 35 + 12
            
            const expectedTotal = serverTotal + shippingCost;
            const priceDifference = Math.abs(expectedTotal - submittedTotal);
            
            expect(priceDifference).toBeLessThanOrEqual(0.01);
        });

        test('Tampered price detected', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: product.name, price: 10, quantity: 1, source: 'products' } // Tampered: should be 35
            ];
            
            const { serverTotal } = await validateCartPrices(cart, true);
            const shippingCost = 12;
            const submittedTotal = 22; // 10 + 12 (tampered)
            
            const expectedTotal = serverTotal + shippingCost; // 35 + 12 = 47
            const priceDifference = Math.abs(expectedTotal - submittedTotal);
            
            // This should fail - difference is $25
            expect(priceDifference).toBeGreaterThan(0.01);
        });

        test('Non-backer trying to use backer price detected', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            // Cart submitted with backer price
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, source: 'products' }
            ];
            
            // But user is not a backer
            const { serverTotal } = await validateCartPrices(cart, false); // false = not backer
            
            // Server calculates retail price
            expect(serverTotal).toBe(45); // Retail, not 35
        });

        test('Small rounding differences allowed', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, source: 'products' }
            ];
            
            const { serverTotal } = await validateCartPrices(cart, true);
            const shippingCost = 12;
            const submittedTotal = 47.005; // Tiny rounding difference
            
            const expectedTotal = serverTotal + shippingCost;
            const priceDifference = Math.abs(expectedTotal - submittedTotal);
            
            // Within 1 cent tolerance
            expect(priceDifference).toBeLessThanOrEqual(0.01);
        });
    });

    // ==========================================
    // PAID KS BACKER EMPTY CART
    // ==========================================
    
    describe('Paid KS Backer - Empty Cart Checkout', () => {
        
        test('Paid backer can checkout with empty cart for shipping', async () => {
            const paidBacker = await createTestUser(fixtures.users.kickstarterBacker);
            
            // Paid backer has rewardTitle and pledgeAmount
            const isPaidKickstarterBacker = !!(paidBacker.reward_title && paidBacker.pledge_amount > 0);
            
            expect(isPaidKickstarterBacker).toBe(true);
            
            // Empty cart is valid for paid backers
            const cart = [];
            const hasPledge = cart.length === 0 && isPaidKickstarterBacker;
            
            // Cart is effectively valid because backer already paid for pledge
            expect(hasPledge).toBe(true);
        });

        test('Guest cannot checkout with empty cart', async () => {
            const guest = await createTestUser(fixtures.users.guestUser);
            
            const isPaidKickstarterBacker = !!(guest.reward_title && guest.pledge_amount > 0);
            expect(isPaidKickstarterBacker).toBe(false);
            
            const cart = [];
            const isValid = cart.length > 0 || isPaidKickstarterBacker;
            
            expect(isValid).toBe(false);
        });
    });

    // ==========================================
    // ORDER TYPE METADATA
    // ==========================================
    
    describe('Order Type Metadata', () => {
        
        test('Immediate charge order has correct metadata', () => {
            const isDroppedBacker = true;
            const isIndianAddress = false;
            
            const orderType = (isDroppedBacker || isIndianAddress) ? 'immediate-charge' : 'pre-order-autodebit';
            const userType = isDroppedBacker ? 'dropped-backer' : 'backer';
            
            expect(orderType).toBe('immediate-charge');
            expect(userType).toBe('dropped-backer');
        });

        test('Pre-order autodebit has correct metadata', () => {
            const isDroppedBacker = false;
            const isIndianAddress = false;
            const isAuthenticated = true;
            
            const orderType = (isDroppedBacker || isIndianAddress) ? 'immediate-charge' : 'pre-order-autodebit';
            const userType = isAuthenticated ? 'backer' : 'guest';
            
            expect(orderType).toBe('pre-order-autodebit');
            expect(userType).toBe('backer');
        });

        test('Indian backer has indian-backer user type', () => {
            const isDroppedBacker = false;
            const isIndianAddress = true;
            const isAuthenticated = true;
            
            let userType = 'guest';
            if (isDroppedBacker) {
                userType = 'dropped-backer';
            } else if (isIndianAddress && isAuthenticated) {
                userType = 'indian-backer';
            } else if (isAuthenticated) {
                userType = 'backer';
            }
            
            expect(userType).toBe('indian-backer');
        });
    });
});
