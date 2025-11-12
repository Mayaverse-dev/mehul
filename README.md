# MAYA Store & Pledge Manager

E-commerce store and pledge manager for MAYA Kickstarter backers with guest checkout functionality.

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm

### Setup

1. **Clone the repository:**
```bash
git clone <your-repo-url>
cd portal
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
```bash
cp env.example .env
```
Then edit `.env` with your:
- Stripe API keys (test mode)
- Session secret
- Admin credentials

4. **Start the server:**
```bash
npm start
```

5. **Visit the store:**
- Store: http://localhost:3000
- Backer Login: http://localhost:3000/backer-login
- Admin Dashboard: http://localhost:3000/admin

## Import Kickstarter Data

To import your Kickstarter CSV:
```bash
npm run import-csv path-to-your-kickstarter.csv
```

This will:
- Create user accounts for all backers
- Generate random passwords
- Send welcome emails with login credentials

## Admin Access

Default admin login:
- Email: admin@yourdomain.com
- Password: changeme123

**Change this in production!**

## Project Structure

```
portal/
├── server.js           # Main server file
├── database.db        # SQLite database (auto-created)
├── public/            # Static files
│   ├── css/
│   ├── js/
│   └── images/
├── views/             # HTML templates
│   └── admin/
├── scripts/           # Utility scripts
└── config/            # Configuration files
```

## ✨ Features

### Public Store
- Product browsing with hero section
- Add to cart functionality
- Multi-step checkout modal (Cart → Shipping → Payment)
- Real-time shipping calculation
- Stripe payment integration
- Guest checkout

### Backer Portal
- Login for existing Kickstarter backers
- View original pledge
- Add optional add-ons
- Complete shipping information
- Order tracking

### Admin Dashboard
- View all orders
- Export to CSV for fulfillment
- Manage add-ons
- Add comped (free) items to orders
- User management

## 🛠 Tech Stack

- **Backend:** Node.js + Express
- **Database:** SQLite
- **Payments:** Stripe
- **Emails:** Nodemailer
- **Frontend:** Plain HTML/CSS/JavaScript

No frameworks, no build steps, just simple code!

## 🤝 Contributing

### Before Making Changes
1. Pull latest changes: `git pull origin main`
2. Create a new branch: `git checkout -b feature/your-feature-name`

### Making Changes
1. Make your changes
2. Test locally
3. Commit with clear messages: `git commit -m "Add feature: description"`
4. Push to GitHub: `git push origin feature/your-feature-name`
5. Create a Pull Request on GitHub

### Important Notes
- **Never commit `.env` file** - it contains secrets!
- **Never commit `database.db`** - it contains customer data!
- Test your changes before pushing
- Keep commits focused and atomic

## 📝 Database Schema

The app uses SQLite with three main tables:
- `users` - Kickstarter backers
- `addons` - Available products
- `orders` - Completed orders with shipping info

## 🔐 Security

- All sensitive data is in `.env` (never committed)
- Passwords are hashed with bcrypt
- Stripe handles payment processing
- Session-based authentication



