/**
 * eBook Tests
 * Eligibility logic (backers excluding dropped) + metrics table existence.
 */

const {
    setupTestDatabase,
    cleanDatabase,
    teardownTestDatabase,
    createTestUser,
    execute,
    queryOne
} = require('./setup');
const fixtures = require('./fixtures');

const { isEligibleBacker, isEligibleBackerByUserId } = require('../../utils/helpers');

describe('eBook - Eligibility and Metrics', () => {

    beforeAll(async () => {
        await setupTestDatabase();
    });

    afterAll(async () => {
        await teardownTestDatabase();
    });

    beforeEach(async () => {
        await cleanDatabase();
    });

    test('isEligibleBacker excludes dropped backers', async () => {
        const dropped = await createTestUser(fixtures.users.droppedBacker);
        expect(isEligibleBacker(dropped)).toBe(false);
    });

    test('isEligibleBacker includes normal Kickstarter backers', async () => {
        const backer = await createTestUser(fixtures.users.kickstarterBacker);
        expect(isEligibleBacker(backer)).toBe(true);
    });

    test('isEligibleBackerByUserId matches dropped vs collected', async () => {
        const backer = await createTestUser(fixtures.users.kickstarterBacker);
        const dropped = await createTestUser(fixtures.users.droppedBacker);

        await expect(isEligibleBackerByUserId(backer.id)).resolves.toBe(true);
        await expect(isEligibleBackerByUserId(dropped.id)).resolves.toBe(false);
    });

    test('SQLite test DB creates ebook_download_events table', async () => {
        const backer = await createTestUser(fixtures.users.kickstarterBacker);

        await execute(
            'INSERT INTO ebook_download_events (user_id, event_type, format, country, user_agent) VALUES ($1, $2, $3, $4, $5)',
            [backer.id, 'page_view', 'page', 'US', 'jest']
        );

        const row = await queryOne('SELECT COUNT(*) as c FROM ebook_download_events', []);
        const count = parseInt(row?.c, 10);
        expect(count).toBe(1);
    });
});

