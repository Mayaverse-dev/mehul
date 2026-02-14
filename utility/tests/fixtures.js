/**
 * Test Fixtures
 * Predefined test data for different user types and scenarios
 */

const fixtures = {
    // ==========================================
    // USER FIXTURES
    // ==========================================
    
    users: {
        // Standard Kickstarter backer with full pledge data
        kickstarterBacker: {
            email: 'backer@test.com',
            backer_number: 123,
            backer_name: 'Test Backer',
            reward_title: 'Industrious Manushya',
            pledge_amount: 75,
            pledged_status: 'collected',
            kickstarter_items: JSON.stringify({
                'MAYA Hardcover': 1,
                'Digital Copy': 1
            }),
            kickstarter_addons: JSON.stringify({
                'MAYA Bookmark': 2,
                'MAYA Sticker': 1
            }),
            pin: '1234'
        },

        // Humble Vaanar tier backer
        humbleVaanarBacker: {
            email: 'vaanar@test.com',
            backer_number: 200,
            backer_name: 'Vaanar Backer',
            reward_title: 'Humble Vaanar',
            pledge_amount: 35,
            pledged_status: 'collected',
            pin: '5678'
        },

        // Founders of Neh tier backer
        foundersBacker: {
            email: 'founders@test.com',
            backer_number: 50,
            backer_name: 'Founders Backer',
            reward_title: 'Founders of Neh',
            pledge_amount: 500,
            pledged_status: 'collected',
            pin: '9999'
        },

        // Dropped backer (Kickstarter payment failed)
        droppedBacker: {
            email: 'dropped@test.com',
            backer_number: 456,
            backer_name: 'Dropped Backer',
            reward_title: 'Humble Vaanar',
            pledge_amount: 35,
            pledged_status: 'dropped',
            pin: '4321'
        },

        // Late pledger (backed after campaign - pays retail)
        latePledger: {
            email: 'late@test.com',
            backer_number: 789,
            backer_name: 'Late Pledger',
            reward_title: 'Benevolent Divya',
            pledge_amount: 150,
            is_late_pledge: 1,
            pledged_status: 'collected',
            pin: '1111'
        },

        // Payment Over Time backer
        paymentOverTimeBacker: {
            email: 'pot@test.com',
            backer_number: 300,
            backer_name: 'POT Backer',
            reward_title: 'Resplendent Garuda',
            pledge_amount: 100,
            amount_due: 50,
            amount_paid: 50,
            pledge_over_time: 1,
            pin: '2222'
        },

        // Guest user (shadow account, no backer data)
        guestUser: {
            email: 'guest@test.com',
            backer_number: null,
            backer_name: null,
            reward_title: null,
            pledge_amount: null
        },

        // New user without PIN set
        newUserNoPin: {
            email: 'newuser@test.com',
            backer_number: 999,
            backer_name: 'New User',
            reward_title: 'Industrious Manushya',
            pledge_amount: 75,
            pin: null,
            pin_hash: null
        }
    },

    // ==========================================
    // PRODUCT FIXTURES (Pledge Tiers)
    // ==========================================
    
    products: {
        humbleVaanar: {
            name: 'Test Humble Vaanar',
            type: 'pledge',
            price: 45,           // Retail price
            backer_price: 35,    // Backer price
            weight: 300,
            description: 'Entry level pledge tier'
        },
        industriousManushya: {
            name: 'Test Industrious Manushya',
            type: 'pledge',
            price: 85,
            backer_price: 75,
            weight: 500,
            description: 'Mid-tier pledge'
        },
        resplendentGaruda: {
            name: 'Test Resplendent Garuda',
            type: 'pledge',
            price: 120,
            backer_price: 100,
            weight: 800,
            description: 'Premium tier pledge'
        },
        benevolentDivya: {
            name: 'Test Benevolent Divya',
            type: 'pledge',
            price: 175,
            backer_price: 150,
            weight: 1000,
            description: 'Deluxe tier pledge'
        },
        foundersOfNeh: {
            name: 'Test Founders of Neh',
            type: 'pledge',
            price: 600,
            backer_price: 500,
            weight: 2000,
            description: 'Ultimate tier pledge'
        }
    },

    // ==========================================
    // ADDON FIXTURES
    // ==========================================
    
    addons: {
        bookmark: {
            name: 'Test MAYA Bookmark',
            price: 15,
            backer_price: 12,
            weight: 20,
            description: 'Beautiful MAYA bookmark'
        },
        sticker: {
            name: 'Test MAYA Sticker',
            price: 10,
            backer_price: 8,
            weight: 10,
            description: 'Premium vinyl sticker'
        },
        poster: {
            name: 'Test MAYA Poster',
            price: 25,
            backer_price: 20,
            weight: 150,
            description: 'High-quality art poster'
        },
        lorebook: {
            name: 'Test Lorebook',
            price: 40,
            backer_price: 35,
            weight: 400,
            description: 'MAYA Lorebook companion'
        },
        builtEnvironments: {
            name: 'Test Built Environments',
            price: 60,
            backer_price: 50,
            weight: 600,
            description: 'Built Environments art book'
        }
    },

    // ==========================================
    // SHIPPING ADDRESS FIXTURES
    // ==========================================
    
    addresses: {
        usa: {
            fullName: 'John Doe',
            email: 'john@test.com',
            addressLine1: '123 Main Street',
            addressLine2: 'Apt 4B',
            city: 'New York',
            state: 'NY',
            postalCode: '10001',
            country: 'United States',
            phone: '+1-555-123-4567'
        },
        india: {
            fullName: 'Raj Kumar',
            email: 'raj@test.com',
            addressLine1: '456 MG Road',
            addressLine2: '',
            city: 'Mumbai',
            state: 'Maharashtra',
            postalCode: '400001',
            country: 'India',
            phone: '+91-9876543210'
        },
        uk: {
            fullName: 'James Smith',
            email: 'james@test.com',
            addressLine1: '10 Downing Street',
            addressLine2: '',
            city: 'London',
            state: '',
            postalCode: 'SW1A 2AA',
            country: 'United Kingdom',
            phone: '+44-20-7946-0958'
        },
        germany: {
            fullName: 'Hans Mueller',
            email: 'hans@test.com',
            addressLine1: 'Berliner Str. 123',
            addressLine2: '',
            city: 'Berlin',
            state: '',
            postalCode: '10115',
            country: 'Germany',
            phone: '+49-30-12345678'
        },
        australia: {
            fullName: 'Bruce Wayne',
            email: 'bruce@test.com',
            addressLine1: '42 Wallaby Way',
            addressLine2: '',
            city: 'Sydney',
            state: 'NSW',
            postalCode: '2000',
            country: 'Australia',
            phone: '+61-2-1234-5678'
        },
        unknownCountry: {
            fullName: 'Mystery Person',
            email: 'mystery@test.com',
            addressLine1: '1 Unknown Street',
            city: 'Unknown City',
            state: '',
            postalCode: '00000',
            country: 'Narnia',
            phone: ''
        }
    },

    // ==========================================
    // CART FIXTURES
    // ==========================================
    
    carts: {
        // Valid cart with one pledge
        validWithPledge: (pledgeId, addonId) => [
            { id: `pledge-${pledgeId}`, name: 'Test Humble Vaanar', price: 35, quantity: 1, type: 'pledge' }
        ],
        
        // Valid cart with pledge and addons
        validWithPledgeAndAddons: (pledgeId, addonId) => [
            { id: `pledge-${pledgeId}`, name: 'Test Humble Vaanar', price: 35, quantity: 1, type: 'pledge' },
            { id: `addon-${addonId}`, name: 'Test MAYA Bookmark', price: 12, quantity: 2 }
        ],
        
        // Invalid: only addons, no pledge
        invalidAddonsOnly: (addonId) => [
            { id: `addon-${addonId}`, name: 'Test MAYA Bookmark', price: 12, quantity: 2 }
        ],
        
        // Invalid: multiple pledges
        invalidMultiplePledges: (pledgeId1, pledgeId2) => [
            { id: `pledge-${pledgeId1}`, name: 'Test Humble Vaanar', price: 35, quantity: 1, type: 'pledge' },
            { id: `pledge-${pledgeId2}`, name: 'Test Industrious Manushya', price: 75, quantity: 1, type: 'pledge' }
        ],
        
        // Empty cart
        empty: []
    },

    // ==========================================
    // ORDER FIXTURES
    // ==========================================
    
    orders: {
        completedOrder: (userId, addressEmail) => ({
            user_id: userId,
            new_addons: JSON.stringify([
                { name: 'Test Humble Vaanar', price: 35, quantity: 1 },
                { name: 'Test MAYA Bookmark', price: 12, quantity: 2 }
            ]),
            shipping_address: JSON.stringify({
                fullName: 'Test User',
                email: addressEmail || 'order@test.com',
                addressLine1: '123 Test St',
                city: 'Test City',
                state: 'TS',
                postalCode: '12345',
                country: 'United States'
            }),
            shipping_cost: 12,
            addons_subtotal: 59,
            total: 71,
            stripe_customer_id: 'cus_test123',
            stripe_payment_intent_id: 'seti_test123',
            stripe_payment_method_id: 'pm_test123',
            payment_status: 'card_saved',
            paid: 0
        }),

        paidOrder: (userId) => ({
            user_id: userId,
            new_addons: JSON.stringify([
                { name: 'Test Humble Vaanar', price: 35, quantity: 1 }
            ]),
            shipping_address: JSON.stringify({
                fullName: 'Paid User',
                email: 'paid@test.com',
                addressLine1: '456 Paid St',
                city: 'Paid City',
                country: 'United States'
            }),
            shipping_cost: 12,
            addons_subtotal: 35,
            total: 47,
            stripe_customer_id: 'cus_paid123',
            stripe_payment_intent_id: 'pi_paid123',
            stripe_payment_method_id: 'pm_paid123',
            payment_status: 'succeeded',
            paid: 1
        })
    }
};

module.exports = fixtures;
