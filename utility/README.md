# Database Utility

## User Lookup
```bash
node utility/lookup-user.js <email or backer_id>

# Examples:
node utility/lookup-user.js user@example.com
node utility/lookup-user.js 12345
```
Displays all important info about a user: identity, backer status, pledge details, Kickstarter items/addons, authentication state, and all orders.

## Sync Local with Prod
```bash
./utility/sync_db.sh
```
*Note: This overwrites local `maya_db`.*

## Local PostgreSQL
```bash
# Start
brew services start postgresql@14

# Stop
brew services stop postgresql@14

# Check status
brew services list | grep postgres
```

## Local Connection
- **URL:** `postgresql://localhost:5432/maya_db`
- **CLI:** `psql "postgresql://localhost:5432/maya_db"`
- **GUI:** Host: `localhost`, Port: `5432`, DB: `maya_db`
