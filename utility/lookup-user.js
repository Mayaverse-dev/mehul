#!/usr/bin/env node
/**
 * User Lookup Script
 * 
 * Usage: node utility/lookup-user.js <email or backer_id>
 * 
 * Displays all important information about a user including:
 * - Identity & contact info
 * - Backer/pledge details
 * - Status flags
 * - Kickstarter items & addons
 * - Authentication state
 * - All orders with details
 */

// Set database URL before requiring database module
if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = 'postgresql://localhost:5432/maya_db';
}

const { initConnection, closeConnections, query, queryOne } = require('../config/database');

// Get user identifier from command line
const userInput = process.argv[2];

if (!userInput) {
    console.error('\n❌ Usage: node utility/lookup-user.js <email or backer_id>\n');
    console.error('Examples:');
    console.error('  node utility/lookup-user.js user@example.com');
    console.error('  node utility/lookup-user.js 12345\n');
    process.exit(1);
}

// Check if input is an email (contains @) or backer_id
const isEmail = userInput.includes('@');

async function lookupUser(input) {
    let user;
    
    if (isEmail) {
        user = await queryOne('SELECT * FROM users WHERE email = $1', [input.toLowerCase()]);
        if (!user) {
            console.error(`\n❌ User with email "${input}" not found in database\n`);
            return null;
        }
    } else {
        user = await queryOne('SELECT * FROM users WHERE backer_number = $1', [parseInt(input)]);
        if (!user) {
            console.error(`\n❌ User with backer_id #${input} not found in database\n`);
            return null;
        }
    }
    
    const orders = await query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
    
    return { user, orders };
}

function formatDate(dateStr) {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function printSection(title) {
    console.log('\n' + '─'.repeat(50));
    console.log(`  ${title}`);
    console.log('─'.repeat(50));
}

function printUser(data) {
    const { user, orders } = data;
    const isBacker = !!(user.backer_number || user.pledge_amount || user.reward_title);
    
    console.log('\n' + '═'.repeat(50));
    console.log(`  USER #${user.id}`);
    console.log('═'.repeat(50));
    
    // ===== IDENTITY =====
    printSection('📧 IDENTITY');
    console.log(`  Email:        ${user.email}`);
    console.log(`  Backer Name:  ${user.backer_name || '—'}`);
    console.log(`  Created:      ${formatDate(user.created_at)}`);
    
    // ===== BACKER STATUS =====
    printSection('🎫 BACKER STATUS');
    if (isBacker) {
        console.log(`  Type:         Kickstarter Backer`);
        console.log(`  Backer #:     ${user.backer_number || '—'}`);
        console.log(`  Backer UID:   ${user.backer_uid || '—'}`);
        console.log(`  Reward Tier:  ${user.reward_title || '—'}`);
        console.log(`  Pledge:       $${user.pledge_amount || 0}`);
        console.log(`  Backing Min:  $${user.backing_minimum || 0}`);
    } else {
        console.log(`  Type:         Guest / Shadow User (not a KS backer)`);
    }
    
    // ===== STATUS FLAGS =====
    printSection('🚩 STATUS FLAGS');
    console.log(`  Pledged Status:   ${user.pledged_status || 'collected'}`);
    console.log(`  Is Late Pledge:   ${user.is_late_pledge === 1 ? '⚠️  YES (pays retail)' : 'No'}`);
    console.log(`  Has Completed:    ${user.has_completed === 1 ? '✅ Yes' : 'No'}`);
    console.log(`  Shipping Country: ${user.shipping_country || '—'}`);
    
    // Check if we have a shipping address from any order
    const orderWithAddress = orders.find(o => {
        if (!o.shipping_address || o.shipping_address === '{}') return false;
        try {
            const addr = JSON.parse(o.shipping_address);
            return addr.addressLine1 || addr.address1 || addr.city;
        } catch { return false; }
    });
    if (orderWithAddress) {
        console.log(`  Has Shipping Addr: ✅ Yes (from order #${orderWithAddress.id})`);
    } else {
        console.log(`  Has Shipping Addr: ❌ No`);
    }
    
    // Payment Over Time
    if (user.amount_due || user.amount_paid || user.pledge_over_time) {
        console.log(`  Payment Over Time: ${user.pledge_over_time === 1 ? 'Yes' : 'No'}`);
        console.log(`  Amount Due:       $${user.amount_due || 0}`);
        console.log(`  Amount Paid:      $${user.amount_paid || 0}`);
    }
    
    // ===== KICKSTARTER ITEMS =====
    printSection('📦 KICKSTARTER ITEMS');
    if (user.kickstarter_items) {
        try {
            const items = JSON.parse(user.kickstarter_items);
            Object.entries(items).forEach(([item, qty]) => {
                console.log(`  • ${item}: ${qty}`);
            });
        } catch {
            console.log(`  ⚠️  Invalid JSON: ${user.kickstarter_items}`);
        }
    } else {
        console.log('  None');
    }
    
    // ===== KICKSTARTER ADDONS =====
    printSection('🎁 KICKSTARTER ADDONS');
    if (user.kickstarter_addons) {
        try {
            const addons = JSON.parse(user.kickstarter_addons);
            Object.entries(addons).forEach(([addon, qty]) => {
                console.log(`  • ${addon}: ${qty}`);
            });
        } catch {
            console.log(`  ⚠️  Invalid JSON: ${user.kickstarter_addons}`);
        }
    } else {
        console.log('  None');
    }
    
    // ===== PLATFORM ADD-ONS (from orders) =====
    printSection('🛍️  PLATFORM ADD-ONS');
    const platformAddons = [];
    orders.forEach(order => {
        if (!order.new_addons) return;
        try {
            const parsed = JSON.parse(order.new_addons);
            if (!Array.isArray(parsed)) return;
            parsed.forEach(item => {
                if (item.isPaidKickstarterPledge || item.isOriginalPledge || 
                    item.isDroppedBackerPledge || item.isPledgeUpgrade) return;
                if (item.id && String(item.id).startsWith('addon-')) {
                    platformAddons.push({ name: item.name, qty: item.quantity || 1, price: item.price || 0, orderId: order.id });
                }
            });
        } catch {}
    });
    if (platformAddons.length > 0) {
        platformAddons.forEach(a => {
            console.log(`  • ${a.name} x${a.qty} @ $${a.price} (order #${a.orderId})`);
        });
    } else {
        console.log('  None');
    }

    // ===== AUTHENTICATION =====
    printSection('🔐 AUTHENTICATION');
    console.log(`  Has PIN:       ${user.pin_hash ? '✅ Yes' : 'No'}`);
    console.log(`  Has Magic Link: ${user.magic_link_token ? 'Yes (expires: ' + formatDate(user.magic_link_expires_at) + ')' : 'No'}`);
    console.log(`  Last Login:    ${formatDate(user.last_login_at)}`);
    console.log(`  Has OTP:       ${user.otp_code ? 'Yes (expires: ' + formatDate(user.otp_expires_at) + ')' : 'No'}`);
    
    // ===== ORDERS =====
    printSection(`🛒 ORDERS (${orders.length} total)`);
    
    if (orders.length === 0) {
        console.log('  No orders yet');
    } else {
        orders.forEach((order, index) => {
            console.log(`\n  ┌─ Order #${order.id} ─────────────────────────────`);
            console.log(`  │ Created:  ${formatDate(order.created_at)}`);
            console.log(`  │ Status:   ${order.payment_status || 'pending'} ${order.paid === 1 ? '✅ PAID' : '⏳ Unpaid'}`);
            console.log(`  │ Total:    $${order.total || 0} (Items: $${order.addons_subtotal || 0} + Shipping: $${order.shipping_cost || 0})`);
            
            // Shipping address
            if (order.shipping_address && order.shipping_address !== '{}') {
                try {
                    const addr = JSON.parse(order.shipping_address);
                    console.log(`  │ Ship To:  ${addr.fullName || addr.name || '—'}`);
                    console.log(`  │           ${addr.addressLine1 || addr.address1 || ''}`);
                    if (addr.addressLine2 || addr.address2) {
                        console.log(`  │           ${addr.addressLine2 || addr.address2}`);
                    }
                    console.log(`  │           ${addr.city || ''}, ${addr.state || ''} ${addr.postalCode || addr.postal || ''}`);
                    console.log(`  │           ${addr.country || ''}`);
                    if (addr.email) {
                        console.log(`  │ Email:    ${addr.email}`);
                    }
                    if (addr.phone) {
                        console.log(`  │ Phone:    ${addr.phone}`);
                    }
                } catch {
                    console.log(`  │ Ship To:  ⚠️  Invalid address JSON`);
                }
            }
            
            // Order items
            if (order.new_addons) {
                try {
                    const parsed = JSON.parse(order.new_addons);

                    // Shape A (current): array of line items
                    if (Array.isArray(parsed)) {
                        if (parsed.length > 0) {
                            console.log(`  │ Items:`);
                            parsed.forEach(item => {
                                console.log(`  │   • ${item.name} x${item.quantity || 1} @ $${item.price || 0}`);
                            });
                        }
                    // Shape B (legacy): object map { "Item Name": qty }
                    } else if (parsed && typeof parsed === 'object') {
                        const entries = Object.entries(parsed);
                        if (entries.length > 0) {
                            console.log(`  │ Items:`);
                            entries.forEach(([name, qty]) => {
                                const q = Number.isFinite(Number(qty)) ? Number(qty) : 1;
                                console.log(`  │   • ${name} x${q}`);
                            });
                        }
                    }
                } catch {
                    console.log(`  │ Items:    ⚠️  Invalid items JSON`);
                }
            }
            
            // Stripe info
            if (order.stripe_customer_id) {
                console.log(`  │ Stripe Customer: ${order.stripe_customer_id}`);
            }
            if (order.stripe_payment_intent_id) {
                console.log(`  │ Payment Intent:  ${order.stripe_payment_intent_id}`);
            }
            if (order.stripe_payment_method_id) {
                console.log(`  │ Payment Method:  ${order.stripe_payment_method_id}`);
            }
            
            // Comped items
            if (order.comped_items) {
                try {
                    const comped = JSON.parse(order.comped_items);
                    if (comped.length > 0) {
                        console.log(`  │ Comped Items:`);
                        comped.forEach(item => {
                            console.log(`  │   🎁 ${item.name} x${item.quantity}${item.note ? ' (' + item.note + ')' : ''}`);
                        });
                    }
                } catch {}
            }
            
            // Admin notes
            if (order.admin_notes) {
                console.log(`  │ Admin Notes: ${order.admin_notes}`);
            }
            
            console.log(`  └${'─'.repeat(45)}`);
        });
    }
    
    console.log('\n' + '═'.repeat(50) + '\n');
}

// Main execution
initConnection();

// Wait for connection then run lookup
setTimeout(async () => {
    try {
        const data = await lookupUser(userInput);
        if (data) {
            printUser(data);
        }
    } catch (err) {
        console.error('\n❌ Error:', err.message, '\n');
    } finally {
        await closeConnections();
        process.exit(0);
    }
}, 1000);
