# MAYA Pledge Manager - Setup Guide

## ✅ Phase 1 Complete!

Your pledge manager is now fully set up and ready to use. Here's what has been created:

### 📁 Project Structure
```
portal/
├── server.js               ✅ Main server (all routes and logic)
├── database.db            ✅ SQLite database (auto-created)
├── package.json           ✅ Dependencies configured
├── .env                   ⚠️  NEEDS CONFIGURATION
├── public/                ✅ Static files
│   ├── css/style.css     ✅ Red & Beige theme
│   ├── js/               ✅ Client-side scripts
│   └── images/addons/    ✅ Product images folder
├── views/                 ✅ All HTML pages
│   ├── login.html        ✅ User login
│   ├── dashboard.html    ✅ Step 2: View order
│   ├── addons.html       ✅ Step 3: Select add-ons
│   ├── shipping.html     ✅ Step 4: Shipping form
│   ├── checkout.html     ✅ Step 5: Payment
│   ├── thankyou.html     ✅ Confirmation page
│   └── admin/            ✅ Admin pages
├── scripts/               ✅ Utility scripts
│   ├── import-csv.js     ✅ Import Kickstarter data
│   └── seed-addons.js    ✅ Seed sample products
└── config/                ✅ Configuration
    └── shipping-rates.js  ✅ Shipping zones & rates
```

---

## 🚀 Quick Start (3 Steps)

### Step 1: Configure Environment Variables

Edit the `.env` file and add your configuration:

**Required:**
- `STRIPE_SECRET_KEY` - Your Stripe secret key
- `STRIPE_PUBLISHABLE_KEY` - Your Stripe publishable key
- `EMAIL_USER` - Your email address for sending emails
- `EMAIL_PASSWORD` - Your email app password
- `ADMIN_EMAIL` - Your admin email
- `ADMIN_PASSWORD` - Your admin password

**Example using Gmail:**
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-gmail-app-password
EMAIL_FROM=MAYA Pledge Manager <your-email@gmail.com>
```

> 💡 **Gmail App Password:** Go to Google Account → Security → 2-Step Verification → App Passwords

### Step 2: Import Kickstarter Data

Run the CSV import script:
```bash
npm run import-csv "MAYA Collector's Edition Novel Trilogy. Signed and Numbered. - All rewards - 2025-10-16 0734 UTC - MAYA Collector's Edition Novel Trilogy. Signed and Numbered. - All rewards - 2025-10-16 0734 UTC.csv.csv"
```

This will:
- ✅ Create user accounts for all ~4000 backers
- ✅ Generate random passwords for each user
- ✅ Send welcome emails with login credentials
- ✅ Parse all Kickstarter pledge data
- ✅ Store all items and add-ons they purchased

### Step 3: Start the Server

```bash
npm start
```

Visit: **http://localhost:3000**

---

## 🔐 Access Points

### User Portal
- **URL:** http://localhost:3000
- **Login:** Use email + password sent to backers

### Admin Dashboard
- **URL:** http://localhost:3000/admin/login
- **Login:** Use credentials from `.env` file
- **Default:** admin@example.com / changeme123 ⚠️ **CHANGE THIS!**

---

## 📊 What's Working Now

### ✅ User Flow (5 Steps)
1. **Login** - Backers login with emailed credentials
2. **Dashboard** - See their Kickstarter pledge, tier, and items
3. **Add-ons** - Browse and add products to cart
4. **Shipping** - Enter address, calculate shipping
5. **Payment** - Stripe checkout, confirmation email

### ✅ Admin Dashboard
- View all backers
- View all orders
- Statistics (revenue, completed orders, etc.)
- Export users and orders to CSV

### ✅ Features
- SQLite database (single file, no setup)
- Session-based authentication
- Stripe payment integration
- Email notifications
- Shipping calculation by zone
- Mobile responsive design
- Red & Beige brand colors

---

## 🎨 Customization

### Add Your Product Images
Add images to: `public/images/addons/`

Then update add-ons in database with image paths:
```sql
UPDATE addons SET image = '/images/addons/pendant.jpg' WHERE name = 'Flitt Locust Pendant';
```

### Adjust Shipping Rates
Edit: `config/shipping-rates.js`

Modify zones and rates to match your actual shipping costs.

### Modify Add-ons
Use the admin dashboard or run:
```bash
node scripts/seed-addons.js
```

Edit `scripts/seed-addons.js` to change product names, prices, descriptions.

---

## 🧪 Testing

### Test with Stripe Test Mode
Use test card: **4242 4242 4242 4242**
- Any future expiry date
- Any 3-digit CVC
- Any postal code

### Test User Flow
1. Create a test user manually in database, or
2. Import CSV and use a real backer's credentials
3. Walk through all 5 steps
4. Check that payment goes through
5. Verify confirmation email is sent

### Test Admin Dashboard
1. Login with admin credentials
2. Check statistics are correct
3. View users and orders
4. Export CSV files

---

## 📧 Email Configuration

### Gmail Setup
1. Enable 2-Step Verification
2. Generate App Password
3. Use in `.env` file

### Other Email Providers
- **SendGrid:** Change `EMAIL_HOST` to `smtp.sendgrid.net`
- **Mailgun:** Change `EMAIL_HOST` to `smtp.mailgun.org`
- **AWS SES:** Change to your SES SMTP endpoint

---

## 🚚 Shipping Configuration

Current zones in `config/shipping-rates.js`:
- **Domestic (US):** $5 base + $2 per item
- **Zone 1 (CA, MX):** $15 base + $5 per item
- **Zone 2 (Europe):** $20 base + $7 per item
- **Zone 3 (Asia-Pacific):** $25 base + $10 per item
- **Zone 4 (Rest of World):** $30 base + $12 per item

**Adjust these based on your actual shipping costs!**

---

## 🐛 Troubleshooting

### Database Issues
If tables are missing:
```bash
rm database.db
npm start
# Tables will be recreated automatically
```

### Port Already in Use
Change port in `.env`:
```env
PORT=3001
```

### Email Not Sending
1. Check email credentials in `.env`
2. For Gmail, make sure you're using App Password, not regular password
3. Check spam folder
4. Enable "Less secure app access" if needed (not recommended)

### Stripe Errors
1. Make sure you're using test keys for testing
2. Check that webhook secret is correct (if using webhooks)
3. Verify Stripe account is activated

---

## 🚀 Deployment

### Option 1: Simple VPS (DigitalOcean, Linode, etc.)
```bash
# On server
git clone your-repo
cd portal
npm install
node server.js

# Use PM2 to keep it running
npm install -g pm2
pm2 start server.js --name maya-pledge-manager
pm2 save
pm2 startup
```

### Option 2: Railway.app (Easiest!)
1. Push code to GitHub
2. Connect Railway to your repo
3. Add environment variables
4. Deploy automatically

### Option 3: Heroku
1. Create `Procfile`: `web: node server.js`
2. `heroku create maya-pledge-manager`
3. `git push heroku main`
4. Set environment variables in Heroku dashboard

---

## 📝 Important Notes

### Security
- ⚠️ **Change admin password** before going live!
- ⚠️ **Never commit `.env` file** to git
- ✅ Passwords are hashed with bcrypt
- ✅ Sessions expire after 24 hours
- ✅ Stripe handles all payment data securely

### Data
- Database file: `database.db` (backup regularly!)
- Session data: Stored in memory (lost on restart)
- Cart data: Stored in browser sessionStorage

### Email
- Welcome emails sent when importing CSV
- Order confirmation emails sent after payment
- Make sure email service is reliable for production

---

## 📖 Next Steps

### Before Going Live:
1. ✅ Configure `.env` with production credentials
2. ✅ Change admin password
3. ✅ Update shipping rates
4. ✅ Add product images
5. ✅ Test entire flow thoroughly
6. ✅ Import real Kickstarter CSV
7. ✅ Switch Stripe to live mode
8. ✅ Deploy to production server

### After Launch:
1. Monitor admin dashboard for orders
2. Export orders regularly for fulfillment
3. Respond to backer emails
4. Keep database backed up

---

## 🎉 You're All Set!

Phase 1 is complete. Your pledge manager is:
- ✅ Simple (no complex frameworks)
- ✅ Fast (plain HTML/CSS/JS)
- ✅ Functional (all 5 steps working)
- ✅ Branded (red & beige colors)
- ✅ Ready for ~4000 backers

**Need help?** Check the code comments in:
- `server.js` - All routes and logic
- `views/*.html` - All page templates
- `scripts/import-csv.js` - CSV import logic

**Happy pledge managing!** 🚀







