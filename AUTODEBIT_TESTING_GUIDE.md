# Autodebit Testing Guide

## Current Status
✅ **2 orders ready for bulk charge** (as of test run)
- Order #18: $91.99
- Order #8: $150.99
- **Total: $242.98**

## Testing Steps

### 1. Check Orders Ready for Charge
```bash
node scripts/test-bulk-charge.js
```

This will show:
- Number of orders with saved cards
- Order details (amount, customer ID, payment method ID)
- Total amount to be charged

### 2. Test Bulk Charge via Admin Dashboard

1. **Start the server:**
   ```bash
   npm start
   ```

2. **Login to Admin Dashboard:**
   - Navigate to: `http://localhost:3000/admin/login`
   - Default credentials:
     - Email: `admin@example.com`
     - Password: `changeme123`

3. **Click "Bulk Charge All" button**
   - Located in the admin dashboard
   - Will show confirmation dialog

4. **Monitor Server Logs:**
   - Watch console for detailed logging:
     ```
     === BULK CHARGE ORDERS REQUEST ===
     Found 2 orders with saved cards ready to charge
     Processing 2 orders...
     
     [1/2] Processing Order #18
       - Amount: $91.99
       - Customer: cus_xxx
       - Payment Method: pm_xxx
       ✓ Payment Intent created: pi_xxx
       ✓ Status: succeeded
       ✓ Order #18 charged successfully
     
     [2/2] Processing Order #8
       ...
     
     === BULK CHARGE SUMMARY ===
     Total orders: 2
     ✓ Successfully charged: 2
     ✗ Failed: 0
     Total amount charged: $242.98
     ```

5. **Check Results:**
   - Admin dashboard will show alert with results
   - Check Stripe Dashboard for payment intents
   - Verify orders in database have `paid = 1` and `payment_status = 'charged'`

### 3. Test Individual Order Charge

You can also charge a single order via API:

```bash
curl -X POST http://localhost:3000/api/admin/charge-order/18 \
  -H "Cookie: connect.sid=YOUR_SESSION_ID" \
  -H "Content-Type: application/json"
```

Or use the admin dashboard if there's a UI for individual charges.

### 4. Verify in Database

Check orders table:
```sql
SELECT 
    id,
    total,
    paid,
    payment_status,
    stripe_payment_intent_id,
    stripe_payment_method_id,
    updated_at
FROM orders
WHERE payment_status = 'charged'
ORDER BY updated_at DESC;
```

## Expected Behavior

### Successful Charge
- Payment Intent created with status `succeeded`
- Order updated: `paid = 1`, `payment_status = 'charged'`
- `stripe_payment_intent_id` populated
- Order appears in Stripe Dashboard

### Failed Charge
Common reasons:
- **Card declined:** Payment method no longer valid
- **Insufficient funds:** Card doesn't have enough balance
- **Expired card:** Card has expired
- **Invalid payment method:** Payment method ID doesn't exist

Failed orders will have:
- `payment_status = 'charge_failed'`
- Error details logged in console
- Error message in bulk charge results

## Testing with Stripe Test Cards

### Successful Charge
- **Card:** `4242 4242 4242 4242`
- **Expiry:** Any future date
- **CVC:** Any 3 digits
- **Result:** Should charge successfully

### Declined Card
- **Card:** `4000 0000 0000 0002`
- **Result:** Should fail with "card_declined"

### Insufficient Funds
- **Card:** `4000 0000 0000 9995`
- **Result:** Should fail with "insufficient_funds"

## Important Notes

1. **Stripe Keys Required:**
   - Make sure `.env` has valid Stripe keys:
     ```
     STRIPE_SECRET_KEY=sk_test_...
     STRIPE_PUBLISHABLE_KEY=pk_test_...
     ```

2. **Off-Session Payments:**
   - Bulk charge uses `off_session: true`
   - This means customer is not present
   - Stripe may require 3D Secure for some cards
   - Failed charges may need customer to re-authenticate

3. **Payment Method Requirements:**
   - Payment method must be saved (`stripe_payment_method_id` exists)
   - Payment method must be attached to customer
   - Payment method must be valid (not expired, not deleted)

4. **Order Status Flow:**
   ```
   pending → card_saved → charged
                    ↓
             charge_failed
   ```

## Troubleshooting

### No Orders Found
- Check if orders have `payment_status = 'card_saved'`
- Verify `stripe_payment_method_id` is populated
- Ensure `paid = 0`

### All Charges Fail
- Check Stripe API keys are valid
- Verify payment methods are still valid
- Check Stripe Dashboard for error details
- Review server logs for specific error messages

### Partial Success
- Some orders charge, others fail
- Check individual order details
- Failed orders may need manual intervention
- Customer may need to update payment method

## Next Steps After Testing

1. ✅ Verify all test charges work correctly
2. ✅ Test with various card scenarios (success, decline, etc.)
3. ✅ Verify database updates correctly
4. ✅ Check Stripe Dashboard for payment intents
5. ⏳ Schedule bulk charge for Jan 24th (production)
6. ⏳ Monitor failed charges and handle manually if needed

---

**Ready to Test:** ✅ Yes  
**Test Script:** `node scripts/test-bulk-charge.js`  
**Admin Dashboard:** `/admin/login` → "Bulk Charge All"

