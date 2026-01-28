require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const emailService = require('../services/emailService');

// Database setup
let pool = null;
let db = null;
let isPostgres = false;

const dbUrl = process.argv[2] || process.env.DATABASE_URL;

if (dbUrl && dbUrl.startsWith('postgresql://')) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });
    isPostgres = true;
    console.log('✓ Using PostgreSQL database');
} else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./database.db');
    console.log('✓ Using SQLite database');
}

async function queryOne(sql, params = []) {
    if (isPostgres) {
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        const result = await pool.query(pgSql, params);
        return result.rows[0] || null;
    } else {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });
    }
}

async function execute(sql, params = []) {
    if (isPostgres) {
        let index = 0;
        const pgSql = sql.replace(/\?/g, () => `$${++index}`);
        await pool.query(pgSql, params);
    } else {
        return new Promise((resolve, reject) => {
            db.run(sql, params, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCSV(csvContent) {
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    
    // Simple CSV parser that handles quoted fields
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }
    
    // Parse header
    const headers = parseCSVLine(lines[0]);
    const emailIndex = headers.indexOf('Email');
    
    if (emailIndex === -1) {
        throw new Error('Email column not found in CSV');
    }
    
    // Parse data rows
    const emails = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > emailIndex) {
            const email = values[emailIndex].trim().replace(/^"|"$/g, ''); // Remove quotes
            if (email && email.includes('@')) {
                emails.push(email.toLowerCase());
            }
        }
    }
    
    return [...new Set(emails)]; // Remove duplicates
}

async function sendMagicLinksToDroppedBackers() {
    try {
        // Read CSV file
        const csvPath = path.join(__dirname, '..', 'Dropped Pledges.csv');
        console.log('📄 Reading CSV file:', csvPath);
        
        if (!fs.existsSync(csvPath)) {
            throw new Error(`CSV file not found: ${csvPath}`);
        }
        
        const csvContent = fs.readFileSync(csvPath, 'utf-8');
        const emails = parseCSV(csvContent);
        
        console.log(`✓ Found ${emails.length} unique email addresses in CSV\n`);
        
        if (emails.length === 0) {
            console.log('No emails found in CSV. Exiting.');
            process.exit(0);
        }
        
        const appUrl = 'https://store.entermaya.com';
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
        
        let sent = 0;
        let skipped = 0;
        let errors = 0;
        
        console.log('🚀 Starting to send magic links...\n');
        
        for (let i = 0; i < emails.length; i++) {
            const email = emails[i];
            
            try {
                // Check if user exists
                const user = await queryOne('SELECT id, email FROM users WHERE email = ?', [email]);
                
                if (!user) {
                    console.log(`⚠️  [${i + 1}/${emails.length}] User not found: ${email}`);
                    skipped++;
                    continue;
                }
                
                // Generate magic link token
                const token = crypto.randomUUID();
                const link = `${appUrl}/auth/magic?token=${token}`;
                
                // Save token to database
                await execute(
                    'UPDATE users SET magic_link_token = ?, magic_link_expires_at = ? WHERE email = ?',
                    [token, expiresAt, email]
                );
                
                // Send email
                const emailResult = await emailService.sendMagicLink(email, link);
                
                if (emailResult.success) {
                    sent++;
                    console.log(`✅ [${i + 1}/${emails.length}] Sent to: ${email}`);
                } else {
                    errors++;
                    console.log(`❌ [${i + 1}/${emails.length}] Failed to send to: ${email} - ${emailResult.error}`);
                }
                
                // Rate limiting: wait 150ms between emails to avoid overwhelming the email service
                if (i < emails.length - 1) {
                    await delay(150);
                }
                
                // Progress update every 50 emails
                if ((i + 1) % 50 === 0) {
                    console.log(`\n📊 Progress: ${i + 1}/${emails.length} processed (${sent} sent, ${skipped} skipped, ${errors} errors)\n`);
                }
                
            } catch (error) {
                errors++;
                console.error(`❌ [${i + 1}/${emails.length}] Error processing ${email}:`, error.message);
            }
        }
        
        console.log(`\n${'='.repeat(60)}`);
        console.log('📊 FINAL SUMMARY');
        console.log(`${'='.repeat(60)}`);
        console.log(`Total emails in CSV: ${emails.length}`);
        console.log(`✅ Successfully sent: ${sent}`);
        console.log(`⚠️  Skipped (user not found): ${skipped}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`${'='.repeat(60)}\n`);
        
        // Close database connection
        if (isPostgres) {
            await pool.end();
        } else {
            db.close();
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

sendMagicLinksToDroppedBackers();

