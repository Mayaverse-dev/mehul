# Railway Deployment Guide

## Quick Start

### 1. Create Railway Project
- Go to [railway.app](https://railway.app) > New Project > Deploy from GitHub
- Select your repository

### 2. Add PostgreSQL
- In Railway project: New > Database > PostgreSQL
- Railway automatically creates `DATABASE_URL`

### 3. Set Environment Variables
In Railway service > Variables tab:

```
NODE_ENV=production
SESSION_SECRET=<generate-64-char-random-string>
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
RESEND_API_KEY=re_...
ADMIN_EMAIL=hello@entermaya.com
ADMIN_PASSWORD=<secure-password>
BACKUP_EMAIL=hello@entermaya.com
```

**Do NOT set DATABASE_URL** - Railway auto-injects it.

### 4. Migrate Data
Get your Railway PostgreSQL URL from the Variables tab, then run locally:

```bash
DATABASE_URL="postgresql://..." node scripts/migrate-to-postgres.js
```

### 5. Enable PostgreSQL Backups
- Click PostgreSQL service > Settings > Enable Point-in-time Recovery

### 6. Deploy
Push to GitHub - Railway auto-deploys.

## Verify Deployment
- [ ] App loads at Railway URL
- [ ] Test backer can login
- [ ] Admin dashboard works at /admin/login
- [ ] Backup email arrives within 1 hour

## Manual Backup
```bash
DATABASE_URL="postgresql://..." node scripts/backup-database.js
```

## Restore from Backup
```bash
gunzip maya-backup-*.sql.gz
psql "postgresql://..." < maya-backup-*.sql
```
