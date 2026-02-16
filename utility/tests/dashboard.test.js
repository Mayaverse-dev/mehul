/**
 * Dashboard Tests
 * Tests for /api/user/data - what users see on their dashboard
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createMockSession,
    queryOne
} = require('./setup');
const fixtures = require('./fixtures');

// Import the helper functions we're testing
const { isBacker, isBackerByUserId } = require('../../utils/helpers');

describe('Dashboard - User Data Display', () => {
    
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
    // PLEDGE IDENTITY TESTS
    // ==========================================
    
    describe('Pledge Identity - User sees their own pledge', () => {
        
        test('Kickstarter backer sees correct reward title', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.reward_title).toBe('Industrious Manushya');
            expect(user.email).toBe('backer@test.com');
        });

        test('Kickstarter backer sees correct pledge amount', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.pledge_amount).toBe(75);
        });

        test('Kickstarter backer sees correct backer number', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.backer_number).toBe(123);
        });

        test('Kickstarter backer sees correct backer name', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.backer_name).toBe('Test Backer');
        });

        test('Different pledge tiers return correct reward titles', async () => {
            const vaanarUser = await createTestUser(fixtures.users.humbleVaanarBacker);
            const foundersUser = await createTestUser(fixtures.users.foundersBacker);
            
            expect(vaanarUser.reward_title).toBe('Humble Vaanar');
            expect(foundersUser.reward_title).toBe('Founders of Neh');
        });

        test('Kickstarter items JSON parsed correctly', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            const items = JSON.parse(user.kickstarter_items);
            expect(items['MAYA Hardcover']).toBe(1);
            expect(items['Digital Copy']).toBe(1);
        });

        test('Kickstarter addons JSON parsed correctly', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            const addons = JSON.parse(user.kickstarter_addons);
            expect(addons['MAYA Bookmark']).toBe(2);
            expect(addons['MAYA Sticker']).toBe(1);
        });

        test('Null kickstarter_items handled gracefully', async () => {
            const user = await createTestUser({
                ...fixtures.users.humbleVaanarBacker,
                kickstarter_items: null
            });
            
            expect(user.kickstarter_items).toBeNull();
            // Frontend should handle: user.kickstarter_items ? JSON.parse(...) : {}
        });

        test('Null kickstarter_addons handled gracefully', async () => {
            const user = await createTestUser({
                ...fixtures.users.humbleVaanarBacker,
                kickstarter_addons: null
            });
            
            expect(user.kickstarter_addons).toBeNull();
        });
    });

    // ==========================================
    // USER TYPE DIFFERENTIATION TESTS
    // ==========================================
    
    describe('User Type Differentiation', () => {
        
        test('Dropped backer has pledged_status = dropped', async () => {
            const user = await createTestUser(fixtures.users.droppedBacker);
            
            expect(user.pledged_status).toBe('dropped');
        });

        test('Normal backer has pledged_status = collected', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.pledged_status).toBe('collected');
        });

        test('Late pledger has is_late_pledge = 1', async () => {
            const user = await createTestUser(fixtures.users.latePledger);
            
            expect(user.is_late_pledge).toBe(1);
        });

        test('Normal backer has is_late_pledge = 0', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.is_late_pledge).toBe(0);
        });

        test('Payment Over Time backer shows amount_due and amount_paid', async () => {
            const user = await createTestUser(fixtures.users.paymentOverTimeBacker);
            
            expect(user.amount_due).toBe(50);
            expect(user.amount_paid).toBe(50);
        });

        test('Guest user has no backer fields', async () => {
            const user = await createTestUser(fixtures.users.guestUser);
            
            expect(user.backer_number).toBeNull();
            expect(user.backer_name).toBeNull();
            expect(user.reward_title).toBeNull();
            expect(user.pledge_amount).toBeNull();
        });
    });

    // ==========================================
    // BACKER STATUS HELPER TESTS
    // ==========================================
    
    describe('Backer Status Helpers', () => {
        
        test('isBacker returns true for user with backer_number', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(isBacker(user)).toBe(true);
        });

        test('isBacker returns true for user with pledge_amount only', async () => {
            const user = await createTestUser({
                email: 'pledge-only@test.com',
                pledge_amount: 50,
                backer_number: null,
                reward_title: null
            });
            
            expect(isBacker(user)).toBe(true);
        });

        test('isBacker returns true for user with reward_title only', async () => {
            const user = await createTestUser({
                email: 'reward-only@test.com',
                reward_title: 'Humble Vaanar',
                backer_number: null,
                pledge_amount: null
            });
            
            expect(isBacker(user)).toBe(true);
        });

        test('isBacker returns false for guest user', async () => {
            const user = await createTestUser(fixtures.users.guestUser);
            
            expect(isBacker(user)).toBe(false);
        });

        test('isBacker returns false for null user', () => {
            expect(isBacker(null)).toBe(false);
        });

        test('isBackerByUserId returns true for backer', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            const result = await isBackerByUserId(user.id);
            expect(result).toBe(true);
        });

        test('isBackerByUserId returns false for guest', async () => {
            const user = await createTestUser(fixtures.users.guestUser);
            
            const result = await isBackerByUserId(user.id);
            expect(result).toBe(false);
        });

        test('isBackerByUserId returns false for null userId', async () => {
            const result = await isBackerByUserId(null);
            expect(result).toBe(false);
        });
    });

    // ==========================================
    // SESSION DATA TESTS
    // ==========================================
    
    describe('Session Data Integrity', () => {
        
        test('Mock session contains correct user data', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const session = createMockSession(user);
            
            expect(session.userId).toBe(user.id);
            expect(session.userEmail).toBe('backer@test.com');
            expect(session.backerNumber).toBe(123);
            expect(session.backerName).toBe('Test Backer');
            expect(session.pledgeAmount).toBe(75);
            expect(session.rewardTitle).toBe('Industrious Manushya');
        });

        test('Session for guest has null backer fields', async () => {
            const user = await createTestUser(fixtures.users.guestUser);
            const session = createMockSession(user);
            
            expect(session.userId).toBe(user.id);
            expect(session.backerNumber).toBeNull();
            expect(session.pledgeAmount).toBeNull();
            expect(session.rewardTitle).toBeNull();
        });
    });

    // ==========================================
    // DATA ISOLATION TESTS
    // ==========================================
    
    describe('Data Isolation - Users see only their own data', () => {
        
        test('Two users have different data', async () => {
            const user1 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'user1@test.com',
                backer_number: 111,
                reward_title: 'Humble Vaanar'
            });
            
            const user2 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'user2@test.com',
                backer_number: 222,
                reward_title: 'Founders of Neh'
            });
            
            // Verify they are different
            expect(user1.id).not.toBe(user2.id);
            expect(user1.backer_number).not.toBe(user2.backer_number);
            expect(user1.reward_title).not.toBe(user2.reward_title);
            
            // Verify querying by ID returns correct user
            const fetchedUser1 = await queryOne('SELECT * FROM users WHERE id = $1', [user1.id]);
            expect(fetchedUser1.email).toBe('user1@test.com');
            expect(fetchedUser1.reward_title).toBe('Humble Vaanar');
            
            const fetchedUser2 = await queryOne('SELECT * FROM users WHERE id = $1', [user2.id]);
            expect(fetchedUser2.email).toBe('user2@test.com');
            expect(fetchedUser2.reward_title).toBe('Founders of Neh');
        });

        test('Query by wrong ID returns different user data', async () => {
            const user1 = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'isolation1@test.com',
                reward_title: 'Humble Vaanar'
            });
            
            const user2 = await createTestUser({
                ...fixtures.users.foundersBacker,
                email: 'isolation2@test.com'
            });
            
            // If we accidentally query user2's ID, we should NOT get user1's data
            const wrongQuery = await queryOne('SELECT * FROM users WHERE id = $1', [user2.id]);
            expect(wrongQuery.reward_title).not.toBe('Humble Vaanar');
            expect(wrongQuery.reward_title).toBe('Founders of Neh');
        });
    });
});
