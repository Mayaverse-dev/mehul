/**
 * SQLite to PostgreSQL Migration Script
 * 
 * Migrates all data from local SQLite database to Railway PostgreSQL
 * 
 * Usage:
 *   1. Set DATABASE_URL to your Railway PostgreSQL connection string
 *   2. Run: node scripts/migrate-to-postgres.js
 * 
 * Note: This script reads from ./database.db (SQLite) and writes to DATABASE_URL (PostgreSQL)
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

// Configuration
const SQLITE_PATH = process.env.SQLITE_PATH || './database.db';
const POSTGRES_URL = process.env.DATABASE_URL;

// Tables to migrate (in order to respect foreign key constraints)
const TABLES_TO_MIGRATE = [
    'admins',
    'users', 
    'products',
    'addons',
    'orders',
    'email_logs'
];

async function migrate() {
    console.log('\n========================================');
    console.log('  SQLite to PostgreSQL Migration Tool');
    console.log('========================================\n');
    
    // Validate environment
    if (!POSTGRES_URL) {
        console.error('❌ DATABASE_URL environment variable not set!');
        console.error('   Set it to your Railway PostgreSQL connection string');
        console.error('   Example: DATABASE_URL=postgresql://user:pass@host:5432/dbname');
        process.exit(1);
    }
    
    console.log(`SQLite source: ${SQLITE_PATH}`);
    console.log(`PostgreSQL target: ${POSTGRES_URL.replace(/:[^:@]+@/, ':****@')}`); // Hide password
    console.log('');
    
    // Connect to SQLite
    const sqlite = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('❌ Failed to open SQLite database:', err.message);
            process.exit(1);
        }
    });
    console.log('✓ Connected to SQLite database');
    
    // Connect to PostgreSQL
    const pg = new Pool({
        connectionString: POSTGRES_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await pg.query('SELECT 1');
        console.log('✓ Connected to PostgreSQL database');
    } catch (err) {
        console.error('❌ Failed to connect to PostgreSQL:', err.message);
        process.exit(1);
    }
    
    console.log('\n--- Starting Migration ---\n');
    
    // Helper to query SQLite
    const sqliteQuery = (sql) => {
        return new Promise((resolve, reject) => {
            sqlite.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    };
    
    // Helper to check if table exists in SQLite
    const tableExists = async (tableName) => {
        const result = await sqliteQuery(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
        );
        return result.length > 0;
    };
    
    // Migrate each table
    for (const table of TABLES_TO_MIGRATE) {
        console.log(`\nMigrating table: ${table}`);
        
        // Check if table exists in SQLite
        const exists = await tableExists(table);
        if (!exists) {
            console.log(`  ⚠️  Table '${table}' not found in SQLite - skipping`);
            continue;
        }
        
        // Get all rows from SQLite
        const rows = await sqliteQuery(`SELECT * FROM ${table}`);
        console.log(`  Found ${rows.length} rows`);
        
        if (rows.length === 0) {
            console.log(`  ✓ No data to migrate`);
            continue;
        }
        
        // Get column names from first row
        const columns = Object.keys(rows[0]);
        
        // Clear existing data in PostgreSQL (optional - be careful!)
        // await pg.query(`DELETE FROM ${table}`);
        // console.log(`  Cleared existing data in PostgreSQL`);
        
        // Insert rows into PostgreSQL
        let successCount = 0;
        let errorCount = 0;
        
        for (const row of rows) {
            const values = columns.map(col => row[col]);
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
            const columnList = columns.join(', ');
            
            // Use ON CONFLICT DO NOTHING to skip duplicates
            const sql = `INSERT INTO ${table} (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
            
            try {
                await pg.query(sql, values);
                successCount++;
            } catch (err) {
                // Log error but continue
                if (errorCount < 3) {
                    console.log(`  ⚠️  Error inserting row: ${err.message}`);
                }
                errorCount++;
            }
        }
        
        console.log(`  ✓ Migrated: ${successCount} rows`);
        if (errorCount > 0) {
            console.log(`  ⚠️  Skipped: ${errorCount} rows (duplicates or errors)`);
        }
        
        // Reset sequence for auto-increment columns
        try {
            const maxIdResult = await pg.query(`SELECT MAX(id) as max_id FROM ${table}`);
            const maxId = maxIdResult.rows[0]?.max_id || 0;
            if (maxId > 0) {
                await pg.query(`SELECT setval('${table}_id_seq', $1, true)`, [maxId]);
                console.log(`  ✓ Reset sequence to ${maxId}`);
            }
        } catch (err) {
            // Sequence might not exist for all tables
            console.log(`  ⚠️  Could not reset sequence: ${err.message}`);
        }
    }
    
    // Close connections
    sqlite.close();
    await pg.end();
    
    console.log('\n========================================');
    console.log('  Migration Complete!');
    console.log('========================================\n');
    console.log('Next steps:');
    console.log('1. Verify data in Railway PostgreSQL dashboard');
    console.log('2. Test login with a known backer email');
    console.log('3. Deploy your app to Railway');
    console.log('');
}

// Run migration
migrate().catch(err => {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
});
