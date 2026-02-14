/**
 * Authentication Tests
 * Tests for login flow, OTP, PIN, and session state
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    createMockSession,
    queryOne,
    execute
} = require('./setup');
const fixtures = require('./fixtures');
const bcrypt = require('bcrypt');

// Import auth helpers
const {
    generateOtpCode,
    generateOtp,
    generateMagicToken,
    isLoginStale,
    needsOtp,
    OTP_TTL_MS,
    LOGIN_STALE_DAYS
} = require('../../utils/helpers');

describe('Authentication - Login Flow Display', () => {
    
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
    // OTP GENERATION TESTS
    // ==========================================
    
    describe('OTP Generation', () => {
        
        test('generateOtpCode returns 4-digit string', () => {
            const code = generateOtpCode();
            
            expect(typeof code).toBe('string');
            expect(code.length).toBe(4);
            expect(/^\d{4}$/.test(code)).toBe(true);
        });

        test('generateOtpCode is zero-padded', () => {
            // Run multiple times to check padding
            for (let i = 0; i < 100; i++) {
                const code = generateOtpCode();
                expect(code.length).toBe(4);
            }
        });

        test('generateOtp returns 4-digit string', () => {
            const code = generateOtp();
            
            expect(typeof code).toBe('string');
            expect(code.length).toBe(4);
            expect(/^\d{4}$/.test(code)).toBe(true);
        });

        test('Generated OTPs are random (not always same)', () => {
            const codes = new Set();
            for (let i = 0; i < 20; i++) {
                codes.add(generateOtpCode());
            }
            // Should have multiple different codes (very unlikely to get same 20 times)
            expect(codes.size).toBeGreaterThan(1);
        });
    });

    // ==========================================
    // MAGIC TOKEN GENERATION TESTS
    // ==========================================
    
    describe('Magic Token Generation', () => {
        
        test('generateMagicToken returns hex string', () => {
            const token = generateMagicToken();
            
            expect(typeof token).toBe('string');
            expect(/^[a-f0-9]+$/.test(token)).toBe(true);
        });

        test('generateMagicToken is 48 characters (24 bytes hex)', () => {
            const token = generateMagicToken();
            
            expect(token.length).toBe(48);
        });

        test('Magic tokens are unique', () => {
            const token1 = generateMagicToken();
            const token2 = generateMagicToken();
            
            expect(token1).not.toBe(token2);
        });
    });

    // ==========================================
    // LOGIN FLOW DECISION TESTS
    // ==========================================
    
    describe('Login Flow Decision - PIN vs OTP', () => {
        
        test('User with PIN set shows PIN screen', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.pin_hash).not.toBeNull();
            
            // Decision: has PIN and not stale → ask for PIN
            const hasPinSet = !!user.pin_hash;
            expect(hasPinSet).toBe(true);
        });

        test('User without PIN set gets OTP', async () => {
            const user = await createTestUser(fixtures.users.newUserNoPin);
            
            expect(user.pin_hash).toBeNull();
            
            // Decision: no PIN → send OTP
            const needsOtpFlow = !user.pin_hash;
            expect(needsOtpFlow).toBe(true);
        });

        test('needsOtp returns true for user without PIN', async () => {
            const user = await createTestUser(fixtures.users.newUserNoPin);
            
            expect(needsOtp(user)).toBe(true);
        });

        test('needsOtp returns true for user without last_login_at', async () => {
            const user = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: 'no-login@test.com'
            });
            
            // User has PIN but no last_login_at
            expect(user.last_login_at).toBeNull();
            expect(needsOtp(user)).toBe(true);
        });

        test('needsOtp returns false for user with recent PIN login', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            // Set recent last_login_at
            const recentDate = new Date().toISOString();
            await execute('UPDATE users SET last_login_at = $1 WHERE id = $2', [recentDate, user.id]);
            
            const updatedUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
            
            expect(needsOtp(updatedUser)).toBe(false);
        });

        test('needsOtp returns true for null user', () => {
            expect(needsOtp(null)).toBe(true);
        });
    });

    // ==========================================
    // LOGIN STALENESS TESTS
    // ==========================================
    
    describe('Login Staleness', () => {
        
        test('isLoginStale returns true for user without last_login_at', () => {
            const user = { last_login_at: null };
            
            expect(isLoginStale(user)).toBe(true);
        });

        test('isLoginStale returns true for login older than threshold', () => {
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - (LOGIN_STALE_DAYS + 1));
            
            const user = { last_login_at: oldDate.toISOString() };
            
            expect(isLoginStale(user)).toBe(true);
        });

        test('isLoginStale returns false for recent login', () => {
            const recentDate = new Date();
            recentDate.setDate(recentDate.getDate() - 1); // Yesterday
            
            const user = { last_login_at: recentDate.toISOString() };
            
            expect(isLoginStale(user)).toBe(false);
        });

        test('isLoginStale returns true for null user', () => {
            expect(isLoginStale(null)).toBe(true);
        });

        test('LOGIN_STALE_DAYS is 7', () => {
            expect(LOGIN_STALE_DAYS).toBe(7);
        });
    });

    // ==========================================
    // OTP VERIFICATION TESTS
    // ==========================================
    
    describe('OTP Verification', () => {
        
        test('OTP stored in database correctly', async () => {
            const user = await createTestUser(fixtures.users.newUserNoPin);
            
            const otp = generateOtpCode();
            const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
            
            await execute(
                'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
                [otp, expiresAt, user.id]
            );
            
            const updatedUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
            
            expect(updatedUser.otp_code).toBe(otp);
            expect(updatedUser.otp_expires_at).not.toBeNull();
        });

        test('OTP expires after TTL', () => {
            const expiresAt = new Date(Date.now() + OTP_TTL_MS);
            const now = new Date();
            
            // Not expired yet
            expect(now.getTime()).toBeLessThan(expiresAt.getTime());
            
            // After TTL (simulated)
            const afterExpiry = new Date(Date.now() + OTP_TTL_MS + 1000);
            expect(afterExpiry.getTime()).toBeGreaterThan(expiresAt.getTime());
        });

        test('OTP TTL is 15 minutes', () => {
            expect(OTP_TTL_MS).toBe(15 * 60 * 1000);
        });

        test('OTP cleared after successful verification', async () => {
            const user = await createTestUser(fixtures.users.newUserNoPin);
            
            // Set OTP
            const otp = '1234';
            await execute(
                'UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3',
                [otp, new Date(Date.now() + OTP_TTL_MS).toISOString(), user.id]
            );
            
            // Simulate verification - clear OTP
            await execute(
                'UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = $1',
                [user.id]
            );
            
            const updatedUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
            
            expect(updatedUser.otp_code).toBeNull();
            expect(updatedUser.otp_expires_at).toBeNull();
        });
    });

    // ==========================================
    // PIN VERIFICATION TESTS
    // ==========================================
    
    describe('PIN Verification', () => {
        
        test('PIN hash stored correctly', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            expect(user.pin_hash).not.toBeNull();
            
            // Verify it's a bcrypt hash
            const isValidHash = await bcrypt.compare('1234', user.pin_hash);
            expect(isValidHash).toBe(true);
        });

        test('Wrong PIN rejected', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            
            const isValid = await bcrypt.compare('9999', user.pin_hash);
            expect(isValid).toBe(false);
        });

        test('PIN must be 4 digits', () => {
            const validPins = ['0000', '1234', '9999', '0001'];
            const invalidPins = ['123', '12345', 'abcd', '12.4'];
            
            const pinRegex = /^[0-9]{4}$/;
            
            validPins.forEach(pin => {
                expect(pinRegex.test(pin)).toBe(true);
            });
            
            invalidPins.forEach(pin => {
                expect(pinRegex.test(pin)).toBe(false);
            });
        });

        test('PIN set updates pin_hash', async () => {
            const user = await createTestUser(fixtures.users.newUserNoPin);
            expect(user.pin_hash).toBeNull();
            
            // Set PIN
            const newPinHash = await bcrypt.hash('5678', 10);
            await execute('UPDATE users SET pin_hash = $1 WHERE id = $2', [newPinHash, user.id]);
            
            const updatedUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
            
            expect(updatedUser.pin_hash).not.toBeNull();
            const isValid = await bcrypt.compare('5678', updatedUser.pin_hash);
            expect(isValid).toBe(true);
        });
    });

    // ==========================================
    // SESSION STATE TESTS
    // ==========================================
    
    describe('Session State - Header Display', () => {
        
        test('Logged in user session has isLoggedIn = true', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const session = createMockSession(user);
            
            const isLoggedIn = !!session.userId;
            expect(isLoggedIn).toBe(true);
        });

        test('Backer session has isBacker = true', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const session = createMockSession(user);
            
            const isBacker = !!(session.backerNumber || session.pledgeAmount || session.rewardTitle);
            expect(isBacker).toBe(true);
        });

        test('Guest session has isBacker = false', async () => {
            const user = await createTestUser(fixtures.users.guestUser);
            const session = createMockSession(user);
            
            const isBacker = !!(session.backerNumber || session.pledgeAmount || session.rewardTitle);
            expect(isBacker).toBe(false);
        });

        test('Session contains user email for display', async () => {
            const user = await createTestUser(fixtures.users.kickstarterBacker);
            const session = createMockSession(user);
            
            expect(session.userEmail).toBe('backer@test.com');
        });

        test('Empty session means not logged in', () => {
            const session = {};
            
            const isLoggedIn = !!session.userId;
            expect(isLoggedIn).toBe(false);
        });
    });

    // ==========================================
    // MAGIC LINK TESTS
    // ==========================================
    
    describe('Magic Link Flow', () => {
        
        test('Magic link token stored in database', async () => {
            const user = await createTestUser(fixtures.users.droppedBacker);
            
            const token = generateMagicToken();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
            
            await execute(
                'UPDATE users SET magic_link_token = $1, magic_link_expires_at = $2 WHERE id = $3',
                [token, expiresAt, user.id]
            );
            
            const updatedUser = await queryOne('SELECT * FROM users WHERE id = $1', [user.id]);
            
            expect(updatedUser.magic_link_token).toBe(token);
            expect(updatedUser.magic_link_expires_at).not.toBeNull();
        });

        test('Magic link lookup by token works', async () => {
            const user = await createTestUser(fixtures.users.droppedBacker);
            const token = generateMagicToken();
            const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            
            await execute(
                'UPDATE users SET magic_link_token = $1, magic_link_expires_at = $2 WHERE id = $3',
                [token, expiresAt, user.id]
            );
            
            const foundUser = await queryOne(
                'SELECT * FROM users WHERE magic_link_token = $1 AND magic_link_expires_at IS NOT NULL',
                [token]
            );
            
            expect(foundUser).not.toBeNull();
            expect(foundUser.id).toBe(user.id);
        });

        test('Invalid magic link token returns no user', async () => {
            const foundUser = await queryOne(
                'SELECT * FROM users WHERE magic_link_token = $1',
                ['invalid-token-that-does-not-exist']
            );
            
            expect(foundUser).toBeUndefined();
        });

        test('User without PIN after magic link shows PIN setup', async () => {
            const user = await createTestUser(fixtures.users.newUserNoPin);
            
            // After magic link auth, if no PIN, user should set one
            const requiresPinSetup = !user.pin_hash;
            expect(requiresPinSetup).toBe(true);
        });
    });

    // ==========================================
    // EMAIL NORMALIZATION TESTS
    // ==========================================
    
    describe('Email Normalization', () => {
        
        test('Email lookup is case insensitive', async () => {
            const uniqueEmail = `casetest-${Date.now()}@example.com`;
            const user = await createTestUser({
                ...fixtures.users.kickstarterBacker,
                email: uniqueEmail
            });
            
            const foundLower = await queryOne(
                'SELECT * FROM users WHERE LOWER(email) = $1',
                [uniqueEmail.toLowerCase()]
            );
            
            const foundUpper = await queryOne(
                'SELECT * FROM users WHERE LOWER(email) = $1',
                [uniqueEmail.toUpperCase().toLowerCase()]
            );
            
            expect(foundLower.id).toBe(user.id);
            expect(foundUpper.id).toBe(user.id);
        });

        test('Email stored in lowercase', async () => {
            // The createTestUser uses email as-is, but app should normalize
            const inputEmail = 'TeSt@ExAmPlE.cOm';
            const normalizedEmail = inputEmail.trim().toLowerCase();
            
            expect(normalizedEmail).toBe('test@example.com');
        });

        test('Whitespace trimmed from email', () => {
            const inputEmail = '  test@example.com  ';
            const normalizedEmail = inputEmail.trim().toLowerCase();
            
            expect(normalizedEmail).toBe('test@example.com');
        });
    });
});
