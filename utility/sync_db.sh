#!/bin/bash

# utility/sync_db.sh - Idempotent script to sync production database to local

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( dirname "$SCRIPT_DIR" )"

cd "$PROJECT_ROOT"

ENV_FILE=".env"
ENV_EXAMPLE="env.example"

# Function to get value from a file
get_val() {
    grep "^$1=" "$2" | cut -d'=' -f2- | tr -d '\r'
}

# Load from .env if it exists
if [ -f "$ENV_FILE" ]; then
    # Export variables, ignoring comments and empty lines
    export $(grep -v '^#' "$ENV_FILE" | grep -v '^$' | xargs)
fi

# Hardcoded Production URL
PROD_URL="postgresql://postgres:hSLlXKyfXiMsDHcGqCmcSXJXdrxJqnIJ@caboose.proxy.rlwy.net:49852/railway"

# Local URL defaults to what's in .env, then env.example, then a hardcoded default
LOCAL_URL=${DATABASE_URL:-$(get_val "DATABASE_URL" "$ENV_EXAMPLE")}

if [ -z "$PROD_URL" ]; then
    echo "❌ Error: DATABASE_URL_PROD not found in .env or env.example"
    exit 1
fi

if [ -z "$LOCAL_URL" ] || [[ "$LOCAL_URL" == *"localhost"* ]]; then
    # Ensure it's a full URL
    if [[ ! "$LOCAL_URL" =~ ^postgresql:// ]]; then
        LOCAL_URL="postgresql://localhost:5432/maya_db"
    fi
fi

echo "🔄 Starting database sync..."
echo "Source: $(echo $PROD_URL | sed 's/:[^:]*@/:****@/')" # Mask password
echo "Target: $LOCAL_URL"

# Extract DB name from LOCAL_URL (everything after the last slash)
LOCAL_DB_NAME=$(echo $LOCAL_URL | sed 's/.*\///' | cut -d'?' -f1)
# Extract base connection string (everything before the last slash, including the slash)
LOCAL_BASE_URL=$(echo $LOCAL_URL | sed "s/\/$LOCAL_DB_NAME.*//")

# If base URL is empty (e.g. just a db name was provided), assume default local postgres
if [ -z "$LOCAL_BASE_URL" ]; then
    LOCAL_BASE_URL="postgresql://localhost:5432"
fi

echo "1️⃣  Recreating local database '$LOCAL_DB_NAME'..."

# Try to drop and recreate. We connect to 'postgres' database to perform these actions.
# We use -t (tuples only) and -c (command)
DROP_CMD="DROP DATABASE IF EXISTS $LOCAL_DB_NAME;"
CREATE_CMD="CREATE DATABASE $LOCAL_DB_NAME;"

if psql "$LOCAL_BASE_URL/postgres" -c "$DROP_CMD" && psql "$LOCAL_BASE_URL/postgres" -c "$CREATE_CMD"; then
    echo "✅ Database '$LOCAL_DB_NAME' recreated successfully."
else
    echo "⚠️  Warning: Could not recreate database automatically. This might be because:"
    echo "   - Local PostgreSQL is not running"
    echo "   - You don't have permissions to drop/create databases"
    echo "   - The 'postgres' database doesn't exist locally"
    echo "Continuing with sync anyway (will attempt to overwrite)..."
fi

echo "2️⃣  Dumping production and restoring to local..."
# --no-owner: skip commands to set ownership of objects
# --no-privileges: skip commands to set access privileges (grant/revoke)
# --clean: include commands to DROP database objects before creating them (backup for idempotency)
# --if-exists: use IF EXISTS when dropping objects
pg_dump "$PROD_URL" --no-owner --no-privileges --clean --if-exists | psql "$LOCAL_URL"

if [ $? -eq 0 ]; then
    echo "✅ Sync complete! Your local database is now up to date."
else
    echo "❌ Error: Sync failed."
    echo "Please ensure:"
    echo "1. Your local PostgreSQL server is running (brew services start postgresql)"
    echo "2. You can connect to it using: psql \"$LOCAL_URL\""
    echo "3. The production URL in env.example or .env is correct."
    exit 1
fi
