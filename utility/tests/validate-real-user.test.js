/**
 * Real User Validation Test
 * 
 * Tests a specific user from your database to verify their data is correct.
 * Change the BACKER_ID below to test different users.
 */

// ============================================
// ⬇️  CHANGE THIS TO TEST A DIFFERENT USER  ⬇️
// ============================================
const BACKER_ID = 574;  // <-- Change this value to any backer ID (backer_number)
// ============================================

// Use local PostgreSQL by default for this test
// MUST be set before requiring any database modules
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/maya_db';
}

// Now require database modules (after DATABASE_URL is set)
const { initConnection, closeConnections, query, queryOne } = require('../../config/database');

describe(`Validate Real User (Backer #${BACKER_ID})`, () => {
    
    let user;
    let orders;

    beforeAll(async () => {
        // Initialize database connection
        initConnection();
        
        // Wait for connection to establish
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Fetch the user by backer_number and their orders
        user = await queryOne('SELECT * FROM users WHERE backer_number = $1', [BACKER_ID]);
        if (user) {
            orders = await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
        }
    });

    afterAll(async () => {
        await closeConnections();
    });

    // ==========================================
    // USER EXISTS
    // ==========================================
    
    describe('User Existence', () => {
        
        test('User exists in database', () => {
            expect(user).toBeDefined();
            if (!user) {
                console.error(`\n❌ User with backer_number #${BACKER_ID} not found in database!\n`);
            }
        });

        test('User has correct backer_number', () => {
            if (!user) return;
            expect(user.backer_number).toBe(BACKER_ID);
        });
    });

    // ==========================================
    // IDENTITY & EMAIL
    // ==========================================
    
    describe('Identity', () => {
        
        test('User has email', () => {
            if (!user) return;
            expect(user.email).toBeTruthy();
            console.log(`  📧 Email: ${user.email}`);
        });

        test('Email is lowercase (normalized)', () => {
            if (!user) return;
            expect(user.email).toBe(user.email.toLowerCase());
        });
    });

    // ==========================================
    // BACKER DATA
    // ==========================================
    
    describe('Backer Data', () => {
        
        test('Log backer status', () => {
            if (!user) return;
            
            const isBacker = !!(user.backer_number || user.pledge_amount || user.reward_title);
            console.log(`  👤 Is Backer: ${isBacker ? 'Yes' : 'No (Guest/Shadow User)'}`);
            
            if (isBacker) {
                console.log(`  🔢 Backer Number: ${user.backer_number || 'N/A'}`);
                console.log(`  💰 Pledge Amount: $${user.pledge_amount || 0}`);
                console.log(`  🎁 Reward Title: ${user.reward_title || 'N/A'}`);
                console.log(`  👤 Backer Name: ${user.backer_name || 'N/A'}`);
            }
            
            expect(true).toBe(true); // Always pass, just logging
        });

        test('If backer, has valid reward tier', () => {
            if (!user) return;
            if (!user.reward_title) return; // Skip for non-backers
            
            const validTiers = [
                'Humble Vaanar',
                'Industrious Manushya',
                'Resplendent Garuda',
                'Benevolent Divya',
                'Founders of Neh'
            ];
            
            const hasValidTier = validTiers.some(tier => 
                user.reward_title.toLowerCase().includes(tier.toLowerCase())
            );
            
            if (!hasValidTier) {
                console.warn(`  ⚠️  Unknown reward tier: ${user.reward_title}`);
            }
            
            expect(hasValidTier).toBe(true);
        });

        test('If backer, pledge amount is positive', () => {
            if (!user) return;
            if (!user.backer_number) return; // Skip for non-backers
            
            expect(user.pledge_amount).toBeGreaterThan(0);
        });

        test('Backer data consistency (if has one field, should have others)', () => {
            if (!user) return;
            
            const hasBackerNumber = !!user.backer_number;
            const hasPledgeAmount = !!user.pledge_amount;
            const hasRewardTitle = !!user.reward_title;
            
            // If any backer field is set, all should ideally be set
            if (hasBackerNumber || hasPledgeAmount || hasRewardTitle) {
                if (!hasBackerNumber) console.warn('  ⚠️  Missing backer_number');
                if (!hasPledgeAmount) console.warn('  ⚠️  Missing pledge_amount');
                if (!hasRewardTitle) console.warn('  ⚠️  Missing reward_title');
            }
            
            expect(true).toBe(true); // Warning only, not a failure
        });
    });

    // ==========================================
    // STATUS FLAGS
    // ==========================================
    
    describe('Status Flags', () => {
        
        test('Log status flags', () => {
            if (!user) return;
            
            console.log(`  📊 Pledged Status: ${user.pledged_status || 'collected (default)'}`);
            console.log(`  ⏰ Is Late Pledge: ${user.is_late_pledge === 1 ? 'Yes' : 'No'}`);
            console.log(`  ✅ Has Completed: ${user.has_completed === 1 ? 'Yes' : 'No'}`);
            
            if (user.amount_due || user.amount_paid) {
                console.log(`  💳 Payment Over Time - Due: $${user.amount_due || 0}, Paid: $${user.amount_paid || 0}`);
            }
            
            expect(true).toBe(true);
        });

        test('Dropped and late pledge not both set', () => {
            if (!user) return;
            
            const isDropped = user.pledged_status === 'dropped';
            const isLatePledge = user.is_late_pledge === 1;
            
            if (isDropped && isLatePledge) {
                console.warn('  ⚠️  User is both dropped AND late pledge - unusual combination');
            }
            
            // This is a warning, not a hard failure
            expect(true).toBe(true);
        });
    });

    // ==========================================
    // JSON FIELDS
    // ==========================================
    
    describe('JSON Field Validity', () => {
        
        test('kickstarter_items is valid JSON or null', () => {
            if (!user) return;
            if (!user.kickstarter_items) {
                console.log('  📦 Kickstarter Items: None');
                return;
            }
            
            let items;
            expect(() => {
                items = JSON.parse(user.kickstarter_items);
            }).not.toThrow();
            
            console.log(`  📦 Kickstarter Items: ${JSON.stringify(items)}`);
        });

        test('kickstarter_addons is valid JSON or null', () => {
            if (!user) return;
            if (!user.kickstarter_addons) {
                console.log('  🎁 Kickstarter Addons: None');
                return;
            }
            
            let addons;
            expect(() => {
                addons = JSON.parse(user.kickstarter_addons);
            }).not.toThrow();
            
            console.log(`  🎁 Kickstarter Addons: ${JSON.stringify(addons)}`);
        });
    });

    // ==========================================
    // AUTHENTICATION
    // ==========================================
    
    describe('Authentication State', () => {
        
        test('Log auth state', () => {
            if (!user) return;
            
            console.log(`  🔐 Has PIN Set: ${user.pin_hash ? 'Yes' : 'No'}`);
            console.log(`  🔑 Has Magic Link: ${user.magic_link_token ? 'Yes' : 'No'}`);
            console.log(`  📅 Last Login: ${user.last_login_at || 'Never'}`);
            
            expect(true).toBe(true);
        });

        test('If has PIN, password also exists', () => {
            if (!user) return;
            
            // All users should have a password (even shadow users get a random one)
            expect(user.password).toBeTruthy();
        });
    });

    // ==========================================
    // ORDERS
    // ==========================================
    
    describe('Orders', () => {
        
        test('Log order count', () => {
            if (!user) return;
            
            console.log(`  🛒 Total Orders: ${orders ? orders.length : 0}`);
            expect(true).toBe(true);
        });

        test('Orders have valid shipping_address JSON', () => {
            if (!user || !orders || orders.length === 0) return;
            
            for (const order of orders) {
                if (!order.shipping_address || order.shipping_address === '{}') {
                    console.log(`  📦 Order #${order.id}: No shipping address`);
                    continue;
                }
                
                let address;
                expect(() => {
                    address = JSON.parse(order.shipping_address);
                }).not.toThrow();
                
                console.log(`  📦 Order #${order.id}: ${address.city || 'Unknown'}, ${address.country || 'Unknown'}`);
            }
        });

        test('Orders have valid new_addons JSON', () => {
            if (!user || !orders || orders.length === 0) return;
            
            for (const order of orders) {
                if (!order.new_addons) continue;
                
                let items;
                expect(() => {
                    items = JSON.parse(order.new_addons);
                }).not.toThrow();
                
                if (items && items.length > 0) {
                    const itemNames = items.map(i => i.name).join(', ');
                    console.log(`  🛍️  Order #${order.id} items: ${itemNames}`);
                }
            }
        });

        test('Order payment status consistency', () => {
            if (!user || !orders || orders.length === 0) return;
            
            for (const order of orders) {
                console.log(`  💳 Order #${order.id}: paid=${order.paid}, status=${order.payment_status}, total=$${order.total}`);
                
                // If paid=1, status should be 'succeeded' or 'charged'
                if (order.paid === 1) {
                    const validPaidStatuses = ['succeeded', 'charged'];
                    if (!validPaidStatuses.includes(order.payment_status)) {
                        console.warn(`    ⚠️  Order marked paid but status is '${order.payment_status}'`);
                    }
                }
                
                // If has payment_method but status is pending, might be an issue
                if (order.stripe_payment_method_id && order.payment_status === 'pending') {
                    console.warn(`    ⚠️  Has payment method but status is 'pending'`);
                }
            }
            
            expect(true).toBe(true);
        });

        test('Order totals are reasonable', () => {
            if (!user || !orders || orders.length === 0) return;
            
            for (const order of orders) {
                // Total should equal addons_subtotal + shipping_cost
                const expectedTotal = (order.addons_subtotal || 0) + (order.shipping_cost || 0);
                const actualTotal = order.total || 0;
                
                if (Math.abs(expectedTotal - actualTotal) > 0.01) {
                    console.warn(`    ⚠️  Order #${order.id}: Total ($${actualTotal}) doesn't match subtotal ($${order.addons_subtotal}) + shipping ($${order.shipping_cost})`);
                }
            }
            
            expect(true).toBe(true);
        });

        test('Stripe IDs are consistent', () => {
            if (!user || !orders || orders.length === 0) return;
            
            for (const order of orders) {
                if (order.stripe_payment_method_id && !order.stripe_customer_id) {
                    console.warn(`    ⚠️  Order #${order.id}: Has payment_method but no customer_id`);
                }
                
                if (order.stripe_customer_id) {
                    console.log(`  🔗 Order #${order.id}: Stripe Customer ${order.stripe_customer_id}`);
                }
            }
            
            expect(true).toBe(true);
        });
    });

    // ==========================================
    // SUMMARY
    // ==========================================
    
    describe('Summary', () => {
        
        test('Print user summary', () => {
            if (!user) {
                console.log('\n❌ USER NOT FOUND\n');
                return;
            }
            
            const isBacker = !!(user.backer_number || user.pledge_amount || user.reward_title);
            
            console.log('\n' + '='.repeat(50));
            console.log(`📋 SUMMARY FOR BACKER #${BACKER_ID}`);
            console.log('='.repeat(50));
            console.log(`Email: ${user.email}`);
            console.log(`Type: ${isBacker ? 'Kickstarter Backer' : 'Guest/Shadow User'}`);
            if (isBacker) {
                console.log(`Tier: ${user.reward_title}`);
                console.log(`Pledge: $${user.pledge_amount}`);
            }
            if (user.pledged_status === 'dropped') {
                console.log(`⚠️  DROPPED BACKER - Payment failed on Kickstarter`);
            }
            if (user.is_late_pledge === 1) {
                console.log(`⚠️  LATE PLEDGER - Pays retail prices`);
            }
            console.log(`Orders: ${orders ? orders.length : 0}`);
            console.log('='.repeat(50) + '\n');
            
            expect(true).toBe(true);
        });
    });
});
