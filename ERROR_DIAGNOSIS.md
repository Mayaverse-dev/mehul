# Error Diagnosis: "Book not available" Alert

## Issue
When clicking "Add to Cart" on the hero section (The Benevolent Divya), users see an alert: **"Book not available. Please refresh the page."**

## Root Cause
The `heroBook` variable is `null` because:
1. **Products table doesn't exist** - The API tries to fetch pledges from a `products` table that doesn't exist in the database
2. **Only add-ons are returned** - The API only returns add-ons from the `addons` table
3. **Hero book not found** - The code searches for "benevolent divya" in products, but it's not there

## Code Flow
```
1. Page loads → loadProducts() called
2. Fetch /api/products
3. API tries to get pledges from products table → fails silently
4. API returns only add-ons
5. Code searches for "benevolent divya" → not found
6. heroBook = null
7. User clicks "Add to Cart" → heroBook is null → alert shown
```

## Fixes Applied

### 1. Enhanced Error Logging (store.html)
- Added console logging throughout product loading
- Logs when hero book is found/not found
- Shows available products for debugging
- Creates fallback hero book if not found

### 2. Fallback Hero Book
- If hero book not found, creates a fallback object:
  ```javascript
  heroBook = {
      id: 'hero-benevolent-divya',
      name: 'The Benevolent Divya',
      price: 190,
      weight: 0,
      type: 'pledge'
  };
  ```

### 3. Retry Logic
- If hero book is null when adding to cart, attempts to reload products
- Retries adding to cart after reload

### 4. Enhanced API Logging (server.js)
- Logs number of pledges found
- Logs number of add-ons found
- Shows error details if products table doesn't exist
- Returns error details in API response

## Current Status

### What Works
- ✅ Add-ons load correctly
- ✅ Add-ons can be added to cart
- ✅ Fallback hero book prevents crash
- ✅ Better error messages in console

### What Needs Fixing
- ⚠️ Products table doesn't exist (pledges not in database)
- ⚠️ Hero book relies on fallback (not from database)

## Solutions

### Option 1: Create Products Table (Recommended)
Create a `products` table and seed it with pledge tiers:

```sql
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'pledge' or 'addon'
    price REAL NOT NULL,
    weight REAL DEFAULT 0,
    image TEXT,
    active INTEGER DEFAULT 1,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Insert The Benevolent Divya
INSERT INTO products (name, type, price, weight, active, description) 
VALUES ('The Benevolent Divya', 'pledge', 190, 0, 1, 'Deluxe pledge tier...');
```

### Option 2: Hardcode Hero Book (Quick Fix)
Keep the fallback hero book in the frontend code (already implemented).

### Option 3: Use Add-ons Table
Add pledge tiers to the `addons` table with a flag to distinguish them.

## Testing

### Check Current State
1. Open browser console
2. Navigate to store page
3. Look for logs:
   ```
   Loading products from API...
   ✓ Loaded X products from API
   ⚠ Hero book "Benevolent Divya" not found in products
   Available products: Flitt Locust Pendant, MAYA Keychain, ...
   Created fallback hero book for display
   ```

### Test Add to Cart
1. Click "Add to Cart" on hero section
2. Should work with fallback hero book
3. Check console for any errors

### Test API
```bash
curl http://localhost:3000/api/products | python3 -m json.tool
```

Should show:
- List of add-ons
- No pledges (products table doesn't exist)

## Next Steps

1. **Immediate:** Fallback hero book prevents crash ✅
2. **Short-term:** Create products table and seed pledge tiers
3. **Long-term:** Ensure all pledge tiers are in database

## Server Logs to Watch

When accessing `/api/products`, you should see:
```
=== API: Get Products ===
⚠ Products table not available or empty, skipping pledges
  Error: no such table: products
✓ Found X add-on(s)
✓ Returning X total products
```

---

**Status:** ✅ Fixed with fallback  
**Permanent Fix Needed:** Create products table with pledge tiers

