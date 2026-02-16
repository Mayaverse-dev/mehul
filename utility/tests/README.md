# Maya Store Tests

Automated tests for user-facing functionality. These tests ensure the application displays correct information to users and handles critical business logic properly.

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm run test:dashboard    # Dashboard/user data tests
npm run test:products     # Pricing display tests
npm run test:shipping     # Shipping calculation tests
npm run test:checkout     # Cart validation & payment flow tests
npm run test:orders       # Order display tests
npm run test:auth         # Authentication flow tests

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

## Validate a Specific User

To validate a specific user from your local database:

1. **Open the test file:**
   ```
   utility/tests/validate-real-user.test.js
   ```

2. **Change the USER_ID at the top:**
   ```javascript
   const USER_ID = 123;  // <-- Change to your user's ID
   ```

3. **Run against your local PostgreSQL database:**
   ```bash
   DATABASE_URL="postgresql://localhost:5432/maya_db" npm run test:user
   ```

   Or if you have DATABASE_URL in your .env file:
   ```bash
   source .env && npm run test:user
   ```

This will validate:
- User exists and has email
- Backer data consistency (tier, amount, number)
- Status flags (dropped, late pledge)
- JSON fields parse correctly
- All orders have valid data
- Payment status consistency

## Test Structure

```
utility/tests/
├── setup.js          # Test utilities, database helpers
├── fixtures.js       # Test data (users, products, addresses)
├── jest.config.js    # Jest configuration
│
├── dashboard.test.js # User sees correct pledge on dashboard
├── products.test.js  # Backer vs retail pricing
├── shipping.test.js  # Shipping cost by country
├── checkout.test.js  # Cart validation, payment flow decisions
├── orders.test.js    # Order display & summary
└── auth.test.js      # Login flow (PIN vs OTP)
```

## Test Coverage by Screen

### Dashboard (`/dashboard`)
- User sees their own pledge tier, amount, backer number
- Kickstarter items and addons display correctly
- Dropped backer, late pledger, POT status flags
- Session data isolation (users can't see each other's data)

### Products/Add-ons Page (`/addons`)
- Kickstarter backers see backer prices
- Guests/late pledgers see retail prices
- Active/inactive product filtering
- Price validation catches tampering

### Shipping Page (`/shipping`)
- Correct zone resolution (USA, EU-1/2/3, India, etc.)
- Pledge tier shipping costs
- Add-on shipping costs accumulate
- Unknown countries fall back to REST OF WORLD

### Checkout (`/checkout`)
- Cart must contain exactly one pledge
- Add-ons alone rejected
- SetupIntent for KS backers (non-India)
- PaymentIntent for Indian/dropped backers/guests
- Server-side price validation

### Thank You Page (`/thankyou`)
- Order summary displays correctly
- Items, address, totals parsed from JSON
- Payment status shown

### Auth/Header
- PIN vs OTP flow decision
- Login staleness (7 days)
- Session state (logged in, backer badge)
- Magic link validation

## Test Data

Tests use SQLite in-memory database (not production). Test fixtures in `fixtures.js` include:

**Users:**
- `kickstarterBacker` - Standard backer with PIN
- `droppedBacker` - Payment failed, pays immediately
- `latePledger` - Pays retail prices
- `guestUser` - No backer data

**Products:**
- All 5 pledge tiers with backer/retail prices
- Sample add-ons (bookmark, sticker, poster, etc.)

**Addresses:**
- USA, India, UK, Germany, Australia, unknown country

## Adding New Tests

1. Add fixtures to `fixtures.js` if needed
2. Create test cases in appropriate test file
3. Use `createTestUser()`, `createTestProduct()`, etc. from `setup.js`
4. Run `npm test` to verify

Example:
```javascript
test('New feature works correctly', async () => {
    const user = await createTestUser(fixtures.users.kickstarterBacker);
    
    // Test your feature
    expect(result).toBe(expected);
});
```

## CI/CD Integration

Add to your CI pipeline:
```yaml
- name: Run tests
  run: npm test
```

Tests exit with code 0 on success, non-zero on failure.
