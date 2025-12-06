# Database Status - PostgreSQL (Railway)

## Database Connection
```
postgresql://postgres:****@shortline.proxy.rlwy.net:47402/railway
```

## Current Database Structure

### Tables
- ✅ `products` - Contains pledge tiers (5 pledges)
- ✅ `addons` - Contains add-ons + pledge tiers (duplicates)
- ✅ `users` - 4,097 users
- ✅ `orders` - 5 orders
- ✅ `admins` - Admin users

### Pledge Tiers in Products Table
1. The Humble Vaanar - $25.00
2. The Industrious Manushya - $50.00
3. The Resplendent Garuda - $150.00
4. The Benevolent Divya - $190.00
5. Founders of Neh - $2,000.00

### Add-ons in Addons Table
- Flitt Locust Pendant - $20
- MAYA: Seed Takes Root Audiobook - $25
- MAYA Lorebook - $35
- Built Environments of MAYA Hardcover - $35
- Plus 5 pledge tiers (duplicates)

## API Behavior

The `/api/products` endpoint:
1. ✅ First tries to get pledges from `products` table (SUCCESS - finds 5 pledges)
2. ✅ Then gets add-ons from `addons` table
3. ✅ Combines both and returns all products

## Status

✅ **Database is correctly configured**
✅ **Products table has all pledge tiers**
✅ **API should work correctly with this setup**
✅ **No changes needed to database structure**

## Notes

- Pledges exist in BOTH `products` and `addons` tables (duplicates)
- API prioritizes `products` table for pledges (correct)
- Store page should find "The Benevolent Divya" from products table
- System is ready for production use

---

**Last Checked:** Current  
**Database Type:** PostgreSQL (Railway)  
**Status:** ✅ Ready

