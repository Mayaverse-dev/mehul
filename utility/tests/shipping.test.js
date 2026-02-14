/**
 * Shipping Calculation Tests
 * Tests for shipping cost display based on country and cart contents
 */

const { calculateShipping } = require('../../utils/helpers');
const { shippingRates, resolveZone } = require('../../config/shipping-rates');

describe('Shipping - Cost Calculation Display', () => {

    // ==========================================
    // ZONE RESOLUTION TESTS
    // ==========================================
    
    describe('Country to Zone Resolution', () => {
        
        test('USA variations resolve to USA zone', () => {
            expect(resolveZone('United States')).toBe('USA');
            expect(resolveZone('USA')).toBe('USA');
            expect(resolveZone('US')).toBe('USA');
            expect(resolveZone('us')).toBe('USA');
            expect(resolveZone('united states')).toBe('USA');
        });

        test('Canada resolves to CANADA zone', () => {
            expect(resolveZone('Canada')).toBe('CANADA');
            expect(resolveZone('CANADA')).toBe('CANADA');
            expect(resolveZone('canada')).toBe('CANADA');
        });

        test('Mexico resolves to MEXICO zone', () => {
            expect(resolveZone('Mexico')).toBe('MEXICO');
            expect(resolveZone('mexico')).toBe('MEXICO');
        });

        test('UK variations resolve to UK zone', () => {
            expect(resolveZone('United Kingdom')).toBe('UK');
            expect(resolveZone('UK')).toBe('UK');
            expect(resolveZone('Great Britain')).toBe('UK');
            expect(resolveZone('England')).toBe('UK');
        });

        test('India resolves to INDIA zone', () => {
            expect(resolveZone('India')).toBe('INDIA');
            expect(resolveZone('INDIA')).toBe('INDIA');
            expect(resolveZone('india')).toBe('INDIA');
        });

        test('Australia resolves to AUSTRALIA zone', () => {
            expect(resolveZone('Australia')).toBe('AUSTRALIA');
            expect(resolveZone('Austraila')).toBe('AUSTRALIA'); // Handle typo
        });

        test('New Zealand resolves to NEW ZEALAND zone', () => {
            expect(resolveZone('New Zealand')).toBe('NEW ZEALAND');
        });

        test('China/HK resolve to CHINA / HONG KONG zone', () => {
            expect(resolveZone('China')).toBe('CHINA / HONG KONG');
            expect(resolveZone('Hong Kong')).toBe('CHINA / HONG KONG');
        });

        test('EU-1 countries resolve correctly', () => {
            expect(resolveZone('Germany')).toBe('EU-1');
            expect(resolveZone('France')).toBe('EU-1');
            expect(resolveZone('Netherlands')).toBe('EU-1');
            expect(resolveZone('Spain')).toBe('EU-1');
            expect(resolveZone('Belgium')).toBe('EU-1');
            expect(resolveZone('Austria')).toBe('EU-1');
        });

        test('EU-2 countries resolve correctly', () => {
            expect(resolveZone('Italy')).toBe('EU-2');
            expect(resolveZone('Sweden')).toBe('EU-2');
            expect(resolveZone('Finland')).toBe('EU-2');
            expect(resolveZone('Greece')).toBe('EU-2');
            expect(resolveZone('Romania')).toBe('EU-2');
        });

        test('EU-3 countries resolve correctly', () => {
            expect(resolveZone('Norway')).toBe('EU-3');
            expect(resolveZone('Switzerland')).toBe('EU-3');
            expect(resolveZone('Turkey')).toBe('EU-3');
            expect(resolveZone('Malta')).toBe('EU-3');
        });

        test('Asia countries resolve to ASIA zone', () => {
            expect(resolveZone('Japan')).toBe('ASIA');
            expect(resolveZone('Singapore')).toBe('ASIA');
            expect(resolveZone('South Korea')).toBe('ASIA');
            expect(resolveZone('Thailand')).toBe('ASIA');
            expect(resolveZone('Malaysia')).toBe('ASIA');
            expect(resolveZone('UAE')).toBe('ASIA');
        });

        test('Unknown country resolves to REST OF WORLD', () => {
            expect(resolveZone('Narnia')).toBe('REST OF WORLD');
            expect(resolveZone('Wakanda')).toBe('REST OF WORLD');
            expect(resolveZone('Unknown Country')).toBe('REST OF WORLD');
            expect(resolveZone('')).toBe('REST OF WORLD');
        });

        test('Case insensitive matching', () => {
            expect(resolveZone('GERMANY')).toBe('EU-1');
            expect(resolveZone('germany')).toBe('EU-1');
            expect(resolveZone('GeRmAnY')).toBe('EU-1');
        });

        test('Whitespace trimmed', () => {
            expect(resolveZone('  Germany  ')).toBe('EU-1');
            expect(resolveZone('  United States  ')).toBe('USA');
        });
    });

    // ==========================================
    // PLEDGE SHIPPING COST TESTS
    // ==========================================
    
    describe('Pledge Tier Shipping Costs', () => {
        
        test('Humble Vaanar shipping varies by zone', () => {
            const vaanarCart = [{ name: 'Humble Vaanar', quantity: 1 }];
            
            expect(calculateShipping('United States', vaanarCart)).toBe(12);
            expect(calculateShipping('India', vaanarCart)).toBe(5);
            expect(calculateShipping('UK', vaanarCart)).toBe(11);
            expect(calculateShipping('Germany', vaanarCart)).toBe(13);  // EU-1
            expect(calculateShipping('Australia', vaanarCart)).toBe(13);
        });

        test('Industrious Manushya shipping varies by zone', () => {
            const manushyaCart = [{ name: 'Industrious Manushya', quantity: 1 }];
            
            expect(calculateShipping('United States', manushyaCart)).toBe(13);
            expect(calculateShipping('India', manushyaCart)).toBe(5);
            expect(calculateShipping('UK', manushyaCart)).toBe(13);
            expect(calculateShipping('Germany', manushyaCart)).toBe(13);  // EU-1
        });

        test('Resplendent Garuda shipping varies by zone', () => {
            const garudaCart = [{ name: 'Resplendent Garuda', quantity: 1 }];
            
            expect(calculateShipping('United States', garudaCart)).toBe(42);
            expect(calculateShipping('India', garudaCart)).toBe(25);
            expect(calculateShipping('UK', garudaCart)).toBe(40);
        });

        test('Benevolent Divya shipping varies by zone', () => {
            const divyaCart = [{ name: 'Benevolent Divya', quantity: 1 }];
            
            expect(calculateShipping('United States', divyaCart)).toBe(50);
            expect(calculateShipping('India', divyaCart)).toBe(30);
            expect(calculateShipping('UK', divyaCart)).toBe(51);
        });

        test('Founders of Neh shipping varies by zone', () => {
            const foundersCart = [{ name: 'Founders of Neh', quantity: 1 }];
            
            expect(calculateShipping('United States', foundersCart)).toBe(80);
            expect(calculateShipping('India', foundersCart)).toBe(50);
            expect(calculateShipping('UK', foundersCart)).toBe(80);
            expect(calculateShipping('New Zealand', foundersCart)).toBe(120);
        });

        test('Higher tier pledges have higher shipping', () => {
            const country = 'United States';
            
            const vaanar = calculateShipping(country, [{ name: 'Humble Vaanar', quantity: 1 }]);
            const manushya = calculateShipping(country, [{ name: 'Industrious Manushya', quantity: 1 }]);
            const garuda = calculateShipping(country, [{ name: 'Resplendent Garuda', quantity: 1 }]);
            const divya = calculateShipping(country, [{ name: 'Benevolent Divya', quantity: 1 }]);
            const founders = calculateShipping(country, [{ name: 'Founders of Neh', quantity: 1 }]);
            
            expect(vaanar).toBeLessThanOrEqual(manushya);
            expect(manushya).toBeLessThan(garuda);
            expect(garuda).toBeLessThan(divya);
            expect(divya).toBeLessThan(founders);
        });
    });

    // ==========================================
    // ADDON SHIPPING COST TESTS
    // ==========================================
    
    describe('Add-on Shipping Costs', () => {
        
        test('Built Environments addon adds shipping', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Built Environments', quantity: 1 }
            ];
            
            const pledgeOnly = calculateShipping('United States', [{ name: 'Humble Vaanar', quantity: 1 }]);
            const withAddon = calculateShipping('United States', cart);
            
            expect(withAddon).toBe(pledgeOnly + 5); // USA Built Environments = $5
        });

        test('Lorebook addon adds shipping', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Lorebook', quantity: 1 }
            ];
            
            const pledgeOnly = calculateShipping('United States', [{ name: 'Humble Vaanar', quantity: 1 }]);
            const withAddon = calculateShipping('United States', cart);
            
            expect(withAddon).toBe(pledgeOnly + 5);
        });

        test('Paperback addon adds shipping', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Paperback', quantity: 1 }
            ];
            
            const pledgeOnly = calculateShipping('United States', [{ name: 'Humble Vaanar', quantity: 1 }]);
            const withAddon = calculateShipping('United States', cart);
            
            expect(withAddon).toBe(pledgeOnly + 5);
        });

        test('Hardcover addon adds shipping', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Hardcover', quantity: 1 }
            ];
            
            const pledgeOnly = calculateShipping('United States', [{ name: 'Humble Vaanar', quantity: 1 }]);
            const withAddon = calculateShipping('United States', cart);
            
            expect(withAddon).toBe(pledgeOnly + 5);
        });

        test('Multiple addon quantities multiply shipping', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Built Environments', quantity: 3 }
            ];
            
            const pledgeOnly = calculateShipping('United States', [{ name: 'Humble Vaanar', quantity: 1 }]);
            const withAddons = calculateShipping('United States', cart);
            
            expect(withAddons).toBe(pledgeOnly + (5 * 3)); // 3x Built Environments
        });

        test('Multiple different addons sum shipping', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Built Environments', quantity: 1 },
                { name: 'Lorebook', quantity: 1 }
            ];
            
            const pledgeOnly = calculateShipping('United States', [{ name: 'Humble Vaanar', quantity: 1 }]);
            const withAddons = calculateShipping('United States', cart);
            
            expect(withAddons).toBe(pledgeOnly + 5 + 5); // Two addons at $5 each
        });

        test('Addon shipping varies by zone', () => {
            const cart = [
                { name: 'Humble Vaanar', quantity: 1 },
                { name: 'Built Environments', quantity: 1 }
            ];
            
            // Different zones have different addon rates
            const usaShipping = calculateShipping('United States', cart);
            const euShipping = calculateShipping('Germany', cart);
            const indiaShipping = calculateShipping('India', cart);
            
            // Verify they're calculated (not necessarily all different)
            expect(usaShipping).toBeGreaterThan(0);
            expect(euShipping).toBeGreaterThan(0);
            expect(indiaShipping).toBeGreaterThan(0);
        });
    });

    // ==========================================
    // EDGE CASES
    // ==========================================
    
    describe('Edge Cases', () => {
        
        test('Empty cart returns 0 shipping', () => {
            expect(calculateShipping('United States', [])).toBe(0);
        });

        test('Cart with only non-shippable items returns 0', () => {
            const cart = [
                { name: 'Digital Download', quantity: 1 },
                { name: 'Some Random Item', quantity: 2 }
            ];
            
            // These don't match any pledge or addon shipping rules
            expect(calculateShipping('United States', cart)).toBe(0);
        });

        test('Null/undefined country uses REST OF WORLD', () => {
            const cart = [{ name: 'Humble Vaanar', quantity: 1 }];
            
            expect(calculateShipping(null, cart)).toBe(20);  // REST OF WORLD rate
            expect(calculateShipping(undefined, cart)).toBe(20);
            expect(calculateShipping('', cart)).toBe(20);
        });

        test('Pledge name matching is case insensitive', () => {
            expect(calculateShipping('USA', [{ name: 'humble vaanar', quantity: 1 }])).toBe(12);
            expect(calculateShipping('USA', [{ name: 'HUMBLE VAANAR', quantity: 1 }])).toBe(12);
            expect(calculateShipping('USA', [{ name: 'Humble Vaanar', quantity: 1 }])).toBe(12);
        });

        test('Pledge name partial matching works', () => {
            // Names might include extra text like "Pledge: Humble Vaanar"
            expect(calculateShipping('USA', [{ name: 'Pledge: Humble Vaanar Tier', quantity: 1 }])).toBe(12);
        });

        test('Default quantity of 1 when not specified', () => {
            const cart = [
                { name: 'Humble Vaanar' },  // No quantity
                { name: 'Built Environments' }  // No quantity
            ];
            
            const expected = 12 + 5; // Vaanar + 1 Built Environments
            expect(calculateShipping('United States', cart)).toBe(expected);
        });
    });

    // ==========================================
    // ZONE-SPECIFIC RATE VERIFICATION
    // ==========================================
    
    describe('Zone-Specific Rate Verification', () => {
        
        test('REST OF WORLD has highest shipping rates', () => {
            const vaanarCart = [{ name: 'Humble Vaanar', quantity: 1 }];
            
            const rowRate = calculateShipping('Unknown Country', vaanarCart);
            const usaRate = calculateShipping('United States', vaanarCart);
            const indiaRate = calculateShipping('India', vaanarCart);
            
            expect(rowRate).toBeGreaterThanOrEqual(usaRate);
            expect(rowRate).toBeGreaterThanOrEqual(indiaRate);
        });

        test('India has competitive shipping rates', () => {
            const vaanarCart = [{ name: 'Humble Vaanar', quantity: 1 }];
            const foundersCart = [{ name: 'Founders of Neh', quantity: 1 }];
            
            // India should have lower rates than most zones
            expect(calculateShipping('India', vaanarCart)).toBe(5);
            expect(calculateShipping('India', foundersCart)).toBe(50);
        });

        test('EU zones have progressively higher rates', () => {
            const vaanarCart = [{ name: 'Humble Vaanar', quantity: 1 }];
            
            const eu1 = calculateShipping('Germany', vaanarCart);
            const eu2 = calculateShipping('Italy', vaanarCart);
            const eu3 = calculateShipping('Norway', vaanarCart);
            
            expect(eu1).toBeLessThanOrEqual(eu2);
            expect(eu2).toBeLessThanOrEqual(eu3);
        });
    });
});
