#!/usr/bin/env node
/**
 * Import Order Zero Script
 * 
 * Processes backers from the "Order Zero" sheet in Found Data PM.xlsx
 * - Only processes rows with Order amount, Shipping amount, and Shipping Address
 * - If user has NO order: creates new order with pledge reference, shipping, and card_saved
 * - If user HAS order: updates shipping_address and sets payment_status to card_saved
 * - Skips emails not found in database
 */

// Set database URL before requiring database module
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/maya_db';
}

const XLSX = require('xlsx');
const { initConnection, closeConnections, query, queryOne, execute } = require('../config/database');

// Parse address string into JSON
function parseAddress(addrString) {
    if (!addrString) return null;
    
    let addr = addrString.trim();
    
    // Extract phone first
    let phone = '';
    const phoneMatch = addr.match(/Phone:\s*\+?([0-9\s\-]+)/i);
    if (phoneMatch) {
        phone = phoneMatch[1].replace(/\s+/g, '').trim();
        addr = addr.replace(/,?\s*Phone:\s*\+?[0-9\s\-]+/i, '');
    }
    
    // Handle country codes stuck to text
    addr = addr.replace(/([A-Z]{2})(Phone)/i, '$1, $2');
    
    // Handle country prefix
    const startsWithCountry = addr.match(/^(US|GB|CA|AU|NZ|DE|FR|IE|IN)\s*,?\s*/i);
    let countryPrefix = '';
    if (startsWithCountry) {
        countryPrefix = startsWithCountry[1].toUpperCase();
        addr = addr.replace(/^(US|GB|CA|AU|NZ|DE|FR|IE|IN)\s*,?\s*/i, '');
    }
    
    const parts = addr.split(',').map(p => p.trim()).filter(p => p);
    
    if (parts.length < 3) {
        return null;
    }
    
    // Identify country
    let country = '';
    const lastPart = parts[parts.length - 1];
    if (lastPart.match(/^(US|GB|CA|AU|NZ|DE|FR|IE|IN|UK|USA|United States|United Kingdom|Canada|Australia|Germany|France|Ireland|India)$/i)) {
        country = lastPart.toUpperCase();
        if (country === 'UK') country = 'GB';
        if (country === 'USA' || country === 'UNITED STATES') country = 'US';
        if (country === 'UNITED KINGDOM') country = 'GB';
        parts.pop();
    } else if (countryPrefix) {
        country = countryPrefix;
    }
    
    // Extract postal code
    let postalCode = '';
    for (let i = parts.length - 1; i >= 0; i--) {
        const usZip = parts[i].match(/\b(\d{5}(-\d{4})?)\b/);
        const ukPostal = parts[i].match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
        
        if (usZip) {
            postalCode = usZip[1];
            parts[i] = parts[i].replace(usZip[0], '').trim();
            if (!parts[i]) parts.splice(i, 1);
            break;
        } else if (ukPostal) {
            postalCode = ukPostal[1].toUpperCase();
            parts[i] = parts[i].replace(ukPostal[0], '').trim();
            if (!parts[i]) parts.splice(i, 1);
            break;
        }
    }
    
    const result = {
        fullName: parts[0] || '',
        addressLine1: parts[1] || '',
        addressLine2: '',
        city: '',
        state: '',
        postalCode: postalCode,
        country: country,
        phone: phone
    };
    
    if (parts.length === 3) {
        result.city = parts[2];
    } else if (parts.length === 4) {
        result.city = parts[2];
        result.state = parts[3];
    } else if (parts.length >= 5) {
        result.addressLine2 = parts[2];
        result.city = parts[3];
        result.state = parts.slice(4).join(', ');
    }
    
    // Clean up
    Object.keys(result).forEach(k => {
        if (typeof result[k] === 'string') {
            result[k] = result[k].trim();
        }
    });
    
    return result;
}

async function main() {
    console.log('\n📦 Import Order Zero - Processing orders from Found Data PM.xlsx\n');
    
    // Read the sheet
    const workbook = XLSX.readFile('utility/Found Data PM.xlsx');
    const sheet = workbook.Sheets['Order Zero'];
    const data = XLSX.utils.sheet_to_json(sheet);
    
    // Filter valid rows
    const validRows = data.filter(row => 
        row['Order amount'] !== undefined && 
        row['Order amount'] !== null &&
        row['Shipping amount'] !== undefined && 
        row['Shipping amount'] !== null &&
        row['Shipping Address']
    );
    
    console.log(`Found ${validRows.length} valid rows to process\n`);
    
    const stats = {
        created: 0,
        updated: 0,
        skippedNoUser: [],
        errors: []
    };
    
    for (const row of validRows) {
        const email = row.Email.toLowerCase();
        const shippingAmount = parseFloat(row['Shipping amount']) || 0;
        const shippingAddress = parseAddress(row['Shipping Address']);
        
        // Find user
        const user = await queryOne('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
        
        if (!user) {
            stats.skippedNoUser.push(email);
            continue;
        }
        
        // Check if user already has an order
        const existingOrder = await queryOne('SELECT id FROM orders WHERE user_id = $1', [user.id]);
        
        try {
            if (existingOrder) {
                // User HAS order -> update shipping_address; only set card_saved if not already paid
                await execute(`
                    UPDATE orders 
                    SET shipping_address = $1,
                        payment_status = CASE WHEN paid = 1 THEN payment_status ELSE 'card_saved' END
                    WHERE id = $2
                `, [
                    JSON.stringify(shippingAddress),
                    existingOrder.id
                ]);
                
                stats.updated++;
                console.log(`✓ Updated order #${existingOrder.id} for ${email}`);
            } else {
                // User has NO order -> create new order
                // Only store pledge reference in new_addons (matching normal checkout flow)
                const newAddons = [];
                if (user.reward_title) {
                    newAddons.push({
                        name: user.reward_title,
                        price: 0,
                        quantity: 1,
                        isPaidKickstarterPledge: true
                    });
                }
                
                const total = shippingAmount;
                
                await execute(`
                    INSERT INTO orders (
                        user_id,
                        shipping_address,
                        shipping_cost,
                        addons_subtotal,
                        total,
                        new_addons,
                        payment_status,
                        paid,
                        created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                `, [
                    user.id,
                    JSON.stringify(shippingAddress),
                    shippingAmount,
                    0,
                    total,
                    JSON.stringify(newAddons),
                    'card_saved',
                    0
                ]);
                
                stats.created++;
                console.log(`✓ Created order for ${email}`);
            }
        } catch (err) {
            stats.errors.push({ email, error: err.message });
            console.log(`✗ Error for ${email}: ${err.message}`);
        }
    }
    
    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Orders created: ${stats.created}`);
    console.log(`Orders updated (address + card_saved): ${stats.updated}`);
    console.log(`Skipped (no user in DB): ${stats.skippedNoUser.length}`);
    console.log(`Errors: ${stats.errors.length}`);
    
    if (stats.skippedNoUser.length > 0) {
        console.log('\n❌ Emails not found in database:');
        stats.skippedNoUser.forEach(e => console.log(`   ${e}`));
    }
    
    if (stats.errors.length > 0) {
        console.log('\n⚠️  Errors:');
        stats.errors.forEach(e => console.log(`   ${e.email}: ${e.error}`));
    }
    
    console.log('\n');
}

// Run
initConnection();

setTimeout(async () => {
    try {
        await main();
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await closeConnections();
        process.exit(0);
    }
}, 1000);
