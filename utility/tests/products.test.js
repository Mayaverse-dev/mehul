/**
 * Products/Pricing Tests
 * Tests for /api/products - backer vs retail pricing
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createTestProduct,
    createTestAddon,
    queryOne
} = require('./setup');
const fixtures = require('./fixtures');

// Import helpers for price validation
const { validateCartPrices, isBackerByUserId } = require('../../utils/helpers');

describe('Products - Pricing Display', () => {
    
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
    // BACKER VS RETAIL PRICING TESTS
    // ==========================================
    
    describe('Backer vs Retail Pricing', () => {
        
        test('Product has both retail and backer prices', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            expect(product.price).toBe(45);        // Retail
            expect(product.backer_price).toBe(35); // Backer
        });

        test('Addon has both retail and backer prices', async () => {
            const addon = await createTestAddon(fixtures.addons.bookmark);
            
            expect(addon.price).toBe(15);        // Retail
            expect(addon.backer_price).toBe(12); // Backer
        });

        test('Backer price is less than retail price', async () => {
            const product = await createTestProduct(fixtures.products.industriousManushya);
            
            expect(product.backer_price).toBeLessThan(product.price);
        });

        test('All pledge tiers have correct price difference', async () => {
            const vaanar = await createTestProduct(fixtures.products.humbleVaanar);
            const manushya = await createTestProduct(fixtures.products.industriousManushya);
            const garuda = await createTestProduct(fixtures.products.resplendentGaruda);
            
            // Verify retail > backer for all
            expect(vaanar.price - vaanar.backer_price).toBe(10);      // $45 - $35 = $10
            expect(manushya.price - manushya.backer_price).toBe(10);  // $85 - $75 = $10
            expect(garuda.price - garuda.backer_price).toBe(20);      // $120 - $100 = $20
        });
    });

    // ==========================================
    // PRICE VALIDATION TESTS
    // ==========================================
    
    describe('validateCartPrices - Server-side price validation', () => {
        
        test('Backer gets backer prices', async () => {
            const backer = await createTestUser(fixtures.users.kickstarterBacker);
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, source: 'products' }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(35); // Backer price
            expect(validatedItems[0].price).toBe(35);
        });

        test('Non-backer gets retail prices', async () => {
            const guest = await createTestUser(fixtures.users.guestUser);
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: product.id, name: product.name, price: 45, quantity: 1, source: 'products' }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, false);
            
            expect(serverTotal).toBe(45); // Retail price
            expect(validatedItems[0].price).toBe(45);
        });

        test('Quantity multiplies correctly', async () => {
            const addon = await createTestAddon(fixtures.addons.bookmark);
            
            const cart = [
                { id: addon.id, name: addon.name, price: 12, quantity: 3, source: 'addons' }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(36); // 12 * 3
            expect(validatedItems[0].subtotal).toBe(36);
        });

        test('Multiple items sum correctly', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            const addon = await createTestAddon(fixtures.addons.bookmark);
            
            const cart = [
                { id: product.id, name: product.name, price: 35, quantity: 1, source: 'products' },
                { id: addon.id, name: addon.name, price: 12, quantity: 2, source: 'addons' }
            ];
            
            const { serverTotal } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(59); // 35 + (12 * 2)
        });

        test('Prefixed IDs resolve correctly (pledge-X format)', async () => {
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            const cart = [
                { id: `pledge-${product.id}`, name: product.name, price: 35, quantity: 1 }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(35);
            expect(validatedItems[0].id).toBe(product.id);
        });

        test('Prefixed IDs resolve correctly (addon-X format)', async () => {
            const addon = await createTestAddon(fixtures.addons.sticker);
            
            const cart = [
                { id: `addon-${addon.id}`, name: addon.name, price: 8, quantity: 1 }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(8);
            expect(validatedItems[0].id).toBe(addon.id);
        });

        test('Invalid product ID throws error', async () => {
            const cart = [
                { id: 99999, name: 'Nonexistent Product', price: 100, quantity: 1, source: 'products' }
            ];
            
            await expect(validateCartPrices(cart, false)).rejects.toThrow();
        });

        test('Pledge upgrade uses submitted price (difference)', async () => {
            const cart = [
                { 
                    id: 'upgrade-1',
                    name: 'Upgrade to Industrious Manushya', 
                    price: 40,  // Difference price
                    quantity: 1,
                    isPledgeUpgrade: true
                }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(40);
            expect(validatedItems[0].isPledgeUpgrade).toBe(true);
        });

        test('Dropped backer original pledge uses submitted price', async () => {
            const cart = [
                { 
                    id: 'original-1',
                    name: 'Humble Vaanar', 
                    price: 35,
                    quantity: 1,
                    isDroppedBackerPledge: true
                }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(35);
            expect(validatedItems[0].isDroppedBackerPledge).toBe(true);
        });

        test('Paid Kickstarter pledge has zero cost', async () => {
            const cart = [
                { 
                    id: 'ks-pledge',
                    name: 'Industrious Manushya', 
                    price: 0,
                    quantity: 1,
                    isPaidKickstarterPledge: true
                }
            ];
            
            const { serverTotal, validatedItems } = await validateCartPrices(cart, true);
            
            expect(serverTotal).toBe(0);
            expect(validatedItems[0].isPaidKickstarterPledge).toBe(true);
        });
    });

    // ==========================================
    // LATE PLEDGER PRICING TESTS
    // ==========================================
    
    describe('Late Pledger Pricing', () => {
        
        test('Late pledger is identified correctly', async () => {
            const latePledger = await createTestUser(fixtures.users.latePledger);
            
            expect(latePledger.is_late_pledge).toBe(1);
        });

        test('Late pledger should get retail prices (isBacker but retail)', async () => {
            const latePledger = await createTestUser(fixtures.users.latePledger);
            const product = await createTestProduct(fixtures.products.humbleVaanar);
            
            // Late pledger IS a backer (has backer_number), but should pay retail
            const isBacker = await isBackerByUserId(latePledger.id);
            expect(isBacker).toBe(true); // They are a backer record-wise
            
            // But the application logic should check is_late_pledge and use retail
            // This is handled in server.js /api/products route
            expect(latePledger.is_late_pledge).toBe(1);
            
            // When is_late_pledge = 1, cart validation should use isBacker = false
            const cart = [
                { id: product.id, name: product.name, price: 45, quantity: 1, source: 'products' }
            ];
            
            // For late pledgers, server passes isBacker=false to validateCartPrices
            const { serverTotal } = await validateCartPrices(cart, false);
            expect(serverTotal).toBe(45); // Retail price
        });
    });

    // ==========================================
    // PRODUCT ACTIVE STATUS TESTS
    // ==========================================
    
    describe('Product Active Status', () => {
        
        test('Only active products are returned', async () => {
            const activeProduct = await createTestProduct({
                ...fixtures.products.humbleVaanar,
                name: 'Test Active Product',
                active: 1
            });
            
            const inactiveProduct = await createTestProduct({
                ...fixtures.products.industriousManushya,
                name: 'Test Inactive Product',
                active: 0
            });
            
            // Active product found
            const active = await queryOne('SELECT * FROM products WHERE id = $1 AND active = 1', [activeProduct.id]);
            expect(active).not.toBeNull();
            
            // Inactive product not found when filtering by active
            const inactive = await queryOne('SELECT * FROM products WHERE id = $1 AND active = 1', [inactiveProduct.id]);
            expect(inactive).toBeUndefined();
        });

        test('Only active addons are returned', async () => {
            const activeAddon = await createTestAddon({
                ...fixtures.addons.bookmark,
                name: 'Test Active Addon',
                active: 1
            });
            
            const inactiveAddon = await createTestAddon({
                ...fixtures.addons.sticker,
                name: 'Test Inactive Addon',
                active: 0
            });
            
            const active = await queryOne('SELECT * FROM addons WHERE id = $1 AND active = 1', [activeAddon.id]);
            expect(active).not.toBeNull();
            
            const inactive = await queryOne('SELECT * FROM addons WHERE id = $1 AND active = 1', [inactiveAddon.id]);
            expect(inactive).toBeUndefined();
        });
    });
});
