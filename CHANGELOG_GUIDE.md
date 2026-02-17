# Changelog Management

The MAYA Pledge Manager now has a built-in changelog system that accepts **Markdown** format.

## How It Works

- Changelogs are stored in the database with **Markdown** formatting
- The system automatically converts Markdown to HTML when displaying on the public changelog page
- Admin panel accepts Markdown input (not HTML)

## Supported Markdown

```markdown
### Headings (use ### for section titles like "Added", "Fixed", "Changed")

**bold text**
*italic text*

- Bullet list item
- Another item

[link text](https://example.com)

`inline code`
```

## Adding New Changelog Entries

### Via Admin Panel

1. Go to http://localhost:3000/admin/login
2. Login with:
   - Email: `hello@entermaya.com`
   - Password: `changeme123`
3. Click the **Changelogs** tab
4. Click **+ New Entry**
5. Fill in the form:
   - **Product**: Select "Pledge Manager" or "eBook: MAYA Book One"
   - **Title**: e.g., "Version 1.5.0"
   - **Body**: Write in Markdown format (see example below)
   - **Tags**: Add comma-separated tags: `feature, fix, update, breaking`
   - **Publish Date**: Select the date
6. Click **Create**

### Example Markdown Entry

```markdown
### Added
- New shipping calculator with live rates
- Support for express shipping option
- Order tracking integration

### Fixed
- Cart not updating on mobile devices
- Email confirmation not sending
- Dashboard loading slowly on first visit

### Changed
- Improved checkout flow UI
- Updated payment processing to be faster
```

## Initial Seeding

The initial changelog from `PLEDGE MANAGER CHANGELOG.md` has been loaded into the database.

To re-seed (this will add duplicates, so only run once):

```bash
npm run seed-changelog
```

## Public Changelog URLs

- Pledge Manager: http://localhost:3000/changelog/Pledgemanager
- eBook: http://localhost:3000/changelog/ebook/MAYA-book-one

## Production Deployment

When deploying to Railway, the changelog table is automatically created. Make sure to:

1. Seed the changelog in production: `npm run seed-changelog`
2. Or manually add entries via the admin panel at `https://store.entermaya.com/admin/login`

## Tag Colors

- `feature` - Green (new features)
- `fix` - Amber (bug fixes)
- `update` - Blue (improvements/changes)
- `breaking` - Red (breaking changes)
