/**
 * Database Backup Script
 * Exports PostgreSQL database and sends it via email using Resend
 * 
 * Can be run manually: node scripts/backup-database.js
 * Or scheduled via cron in server.js
 */

const { execSync } = require('child_process');
const { Resend } = require('resend');
const zlib = require('zlib');

async function runBackup() {
    const dbUrl = process.env.DATABASE_URL;
    const resendApiKey = process.env.RESEND_API_KEY;
    const backupEmail = process.env.BACKUP_EMAIL || 'hello@entermaya.com';
    
    // Validate required environment variables
    if (!dbUrl) {
        console.log('⚠️  No DATABASE_URL set - skipping backup (SQLite mode or not configured)');
        return { success: false, reason: 'no_database_url' };
    }
    
    if (!resendApiKey) {
        console.error('❌ RESEND_API_KEY not set - cannot send backup email');
        return { success: false, reason: 'no_resend_key' };
    }
    
    const timestamp = new Date().toISOString();
    const filename = `maya-backup-${timestamp.replace(/[:.]/g, '-')}.sql.gz`;
    
    console.log(`\n=== Database Backup Started ===`);
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Target email: ${backupEmail}`);
    
    try {
        // Run pg_dump to export the database
        console.log('Running pg_dump...');
        const dump = execSync(`pg_dump "${dbUrl}" --no-owner --no-acl`, { 
            maxBuffer: 50 * 1024 * 1024,  // 50MB buffer
            encoding: 'buffer'
        });
        
        const originalSize = dump.length;
        console.log(`✓ Database exported: ${(originalSize / 1024).toFixed(2)} KB`);
        
        // Compress the dump
        console.log('Compressing backup...');
        const compressed = zlib.gzipSync(dump);
        const compressedSize = compressed.length;
        console.log(`✓ Compressed: ${(compressedSize / 1024).toFixed(2)} KB (${((1 - compressedSize/originalSize) * 100).toFixed(1)}% reduction)`);
        
        // Check size limit (Resend has ~25MB attachment limit)
        if (compressedSize > 20 * 1024 * 1024) {
            console.warn('⚠️  Backup is very large (>20MB). Consider alternative backup storage.');
        }
        
        // Send via Resend
        console.log('Sending backup email...');
        const resend = new Resend(resendApiKey);
        
        const emailResult = await resend.emails.send({
            from: 'MAYA Backups <backups@entermaya.com>',
            to: backupEmail,
            subject: `MAYA DB Backup - ${timestamp}`,
            html: `
                <h2>MAYA Database Backup</h2>
                <p>Automated hourly backup completed successfully.</p>
                <table style="border-collapse: collapse; margin: 20px 0;">
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Timestamp</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${timestamp}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Original Size</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${(originalSize / 1024).toFixed(2)} KB</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Compressed Size</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${(compressedSize / 1024).toFixed(2)} KB</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>Filename</strong></td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${filename}</td>
                    </tr>
                </table>
                <p style="color: #666; font-size: 12px;">
                    To restore: <code>gunzip ${filename} && psql DATABASE_URL < ${filename.replace('.gz', '')}</code>
                </p>
            `,
            attachments: [{
                filename: filename,
                content: compressed.toString('base64')
            }]
        });
        
        console.log(`✓ Backup email sent successfully`);
        console.log(`  Message ID: ${emailResult.data?.id || 'N/A'}`);
        console.log(`=== Backup Complete ===\n`);
        
        return { 
            success: true, 
            messageId: emailResult.data?.id,
            originalSize,
            compressedSize,
            filename
        };
        
    } catch (error) {
        console.error(`❌ Backup failed: ${error.message}`);
        
        // Try to send error notification
        try {
            const resend = new Resend(resendApiKey);
            await resend.emails.send({
                from: 'MAYA Backups <backups@entermaya.com>',
                to: backupEmail,
                subject: `⚠️ MAYA DB Backup FAILED - ${timestamp}`,
                html: `
                    <h2 style="color: red;">Database Backup Failed</h2>
                    <p><strong>Error:</strong> ${error.message}</p>
                    <p><strong>Timestamp:</strong> ${timestamp}</p>
                    <p>Please check the server logs for more details.</p>
                `
            });
            console.log('Error notification email sent');
        } catch (emailErr) {
            console.error('Could not send error notification:', emailErr.message);
        }
        
        return { success: false, error: error.message };
    }
}

// Allow running directly from command line
if (require.main === module) {
    require('dotenv').config();
    runBackup()
        .then(result => {
            console.log('Result:', result);
            process.exit(result.success ? 0 : 1);
        })
        .catch(err => {
            console.error('Unexpected error:', err);
            process.exit(1);
        });
}

module.exports = { runBackup };
