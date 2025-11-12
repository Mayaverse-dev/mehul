require('dotenv').config();
const fs = require('fs');
const csv = require('csv-parser');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');

// Check if CSV file path is provided
if (process.argv.length < 3) {
    console.error('❌ Please provide the path to the Kickstarter CSV file');
    console.log('Usage: node scripts/import-csv.js path-to-kickstarter.csv');
    process.exit(1);
}

const csvFilePath = process.argv[2];

// Check if file exists
if (!fs.existsSync(csvFilePath)) {
    console.error('❌ File not found:', csvFilePath);
    process.exit(1);
}

console.log('📂 Reading CSV file:', csvFilePath);

// Connect to database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('❌ Error opening database:', err);
        process.exit(1);
    }
    console.log('✓ Connected to database');
});

// Email transporter
const emailTransporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Generate random password
function generatePassword(length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Send welcome email
async function sendWelcomeEmail(email, password, backerName) {
    const mailOptions = {
        from: process.env.EMAIL_FROM || 'MAYA Pledge Manager <noreply@example.com>',
        to: email,
        subject: 'Welcome to MAYA Pledge Manager',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background-color: #dc2626; color: white; padding: 30px; text-align: center;">
                    <h1 style="margin: 0;">MAYA Pledge Manager</h1>
                    <p style="margin: 10px 0 0 0;">Your Kickstarter Journey Continues</p>
                </div>
                
                <div style="padding: 30px; background-color: #f5f1ea;">
                    <p>Hello ${backerName || 'Backer'},</p>
                    
                    <p>Thank you for backing MAYA on Kickstarter! We're excited to have you as part of our community.</p>
                    
                    <p>Your pledge manager is now ready. You can:</p>
                    <ul>
                        <li>Review your Kickstarter pledge</li>
                        <li>Add exclusive add-ons to your order</li>
                        <li>Provide your shipping address</li>
                        <li>Complete your order</li>
                    </ul>
                    
                    <div style="background-color: white; padding: 20px; margin: 20px 0; border-left: 4px solid #dc2626;">
                        <h3 style="margin-top: 0; color: #dc2626;">Your Login Credentials</h3>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Password:</strong> <code style="background-color: #f5f1ea; padding: 5px 10px; border-radius: 4px;">${password}</code></p>
                    </div>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${process.env.APP_URL || 'http://localhost:3000'}" 
                           style="background-color: #dc2626; color: white; padding: 15px 40px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                            Access Pledge Manager
                        </a>
                    </div>
                    
                    <p style="font-size: 14px; color: #666;">
                        If you have any questions, please reply to this email or contact us at support@entermaya.com
                    </p>
                    
                    <p style="font-size: 14px; color: #666;">
                        Thank you for your support!<br>
                        The MAYA Team
                    </p>
                </div>
                
                <div style="background-color: #c8b696; color: #665239; padding: 20px; text-align: center; font-size: 12px;">
                    <p style="margin: 0;">© 2025 MAYA. All rights reserved.</p>
                </div>
            </div>
        `
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Email error for', email, ':', error.message);
        return false;
    }
}

// Item name mappings
const itemColumns = {
    'MAYA : Seed Takes Root ebook (Edition Zero)': 'ebook',
    'MAYA : Seed Takes Root Paperback (Edition Zero)': 'paperback',
    'MAYA : Seed Takes Root Audiobook (Narrated by Hugo Weaving)': 'audiobook',
    'MAYA : Seed Takes Root Hardcover (Edition Zero)': 'hardcover',
    'MAYA : Whispers In The Soil | Book 2 Hardcover': 'book2_hardcover',
    'MAYA : It Becomes The Forest | Book 3 Hardcover': 'book3_hardcover',
    'MAYA Lore : It\'s Species And Their Cultures (Edition Zero)': 'lorebook',
    'Built Environments of MAYA Hardcover (Phase 1 & 2)': 'built_env',
    'Flitt Locust Pendant': 'pendant',
    'Limited Edition MAYA Art Book': 'art_book',
    'MAYA : Whispers In The Soil | Book 2 Live Access': 'book2_live',
    'MAYA : It Becomes The Forest | Book 3 Live Access': 'book3_live'
};

const addonColumns = {
    '[Addon: 10750435] Flitt Locust Pendant': 'pendant',
    '[Addon: 10750413] MAYA: Seed Takes Root Audiobook': 'audiobook_addon',
    '[Addon: 10753939] Built Environments of MAYA Hardcover': 'built_env_addon',
    '[Addon: 10753941] MAYA Lorebook': 'lorebook_addon'
};

// Parse CSV and import data
let importedCount = 0;
let errorCount = 0;
let emailsSent = 0;

const rows = [];

fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
        rows.push(row);
    })
    .on('end', async () => {
        console.log(`\n📊 Found ${rows.length} rows in CSV\n`);
        console.log('🔄 Processing backers...\n');

        for (const row of rows) {
            try {
                const email = row['Email'];
                
                // Skip if no email
                if (!email || email.trim() === '') {
                    continue;
                }

                // Extract basic info
                const backerNumber = parseInt(row['Backer Number']) || null;
                const backerUID = row['Backer UID'];
                const backerName = row['Backer Name'];
                const rewardTitle = row['Reward Title'];
                const backingMinimum = parseFloat(row['Backing Minimum'].replace(/[$,]/g, '')) || 0;
                const pledgeAmount = parseFloat(row['Pledge Amount'].replace(/[$,]/g, '')) || 0;
                const shippingCountry = row['Shipping Country'];

                // Parse Kickstarter items
                const items = {};
                for (const [columnName, itemKey] of Object.entries(itemColumns)) {
                    const quantity = parseInt(row[columnName]) || 0;
                    if (quantity > 0) {
                        items[itemKey] = quantity;
                    }
                }

                // Parse Kickstarter add-ons
                const addons = {};
                for (const [columnName, addonKey] of Object.entries(addonColumns)) {
                    const quantity = parseInt(row[columnName]) || 0;
                    if (quantity > 0) {
                        addons[addonKey] = quantity;
                    }
                }

                // Generate password
                const password = generatePassword();
                const hashedPassword = await bcrypt.hash(password, 10);

                // Insert into database
                await new Promise((resolve, reject) => {
                    db.run(`INSERT OR REPLACE INTO users (
                        email, password, backer_number, backer_uid, backer_name,
                        reward_title, backing_minimum, pledge_amount,
                        kickstarter_items, kickstarter_addons, shipping_country
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        email,
                        hashedPassword,
                        backerNumber,
                        backerUID,
                        backerName,
                        rewardTitle,
                        backingMinimum,
                        pledgeAmount,
                        JSON.stringify(items),
                        JSON.stringify(addons),
                        shippingCountry
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });

                importedCount++;

                // Send welcome email
                const emailSent = await sendWelcomeEmail(email, password, backerName);
                if (emailSent) {
                    emailsSent++;
                }

                // Progress indicator
                if (importedCount % 10 === 0) {
                    process.stdout.write(`✓ Imported ${importedCount} backers...\r`);
                }

            } catch (error) {
                errorCount++;
                console.error(`\n❌ Error importing ${row['Email']}:`, error.message);
            }
        }

        console.log('\n\n' + '='.repeat(60));
        console.log('📊 IMPORT COMPLETE');
        console.log('='.repeat(60));
        console.log(`✓ Successfully imported: ${importedCount} backers`);
        console.log(`📧 Emails sent: ${emailsSent}`);
        if (errorCount > 0) {
            console.log(`❌ Errors: ${errorCount}`);
        }
        console.log('='.repeat(60) + '\n');

        // Close database
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err);
            }
            process.exit(0);
        });
    })
    .on('error', (error) => {
        console.error('❌ Error reading CSV file:', error);
        process.exit(1);
    });



