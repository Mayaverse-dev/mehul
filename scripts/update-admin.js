require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

// Your new admin credentials
const NEW_ADMIN_EMAIL = 'hello@entermaya.com';
const NEW_ADMIN_PASSWORD = 'Incorrect@123456789';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_LOCAL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function updateAdmin() {
    try {
        console.log('🔧 Updating admin credentials...\n');

        // Check current admins
        console.log('📋 Current admins:');
        const currentAdmins = await pool.query('SELECT id, email, name FROM admins');
        currentAdmins.rows.forEach(admin => {
            console.log(`  - ${admin.email} (ID: ${admin.id})`);
        });
        console.log('');

        // Hash new password
        console.log('🔐 Hashing new password...');
        const hashedPassword = await bcrypt.hash(NEW_ADMIN_PASSWORD, 10);
        console.log('✓ Password hashed\n');

        // Update or create admin
        console.log('💾 Updating admin...');
        
        // First, delete old admin@example.com if it exists
        const deleteResult = await pool.query(
            'DELETE FROM admins WHERE email = $1',
            ['admin@example.com']
        );
        if (deleteResult.rowCount > 0) {
            console.log('✓ Deleted old admin@example.com\n');
        }
        
        // Now update or create the new admin
        const updateResult = await pool.query(
            'UPDATE admins SET password = $1 WHERE email = $2 RETURNING *',
            [hashedPassword, NEW_ADMIN_EMAIL]
        );

        if (updateResult.rowCount > 0) {
            console.log(`✓ Updated password for ${NEW_ADMIN_EMAIL}\n`);
        } else {
            // Create new admin if doesn't exist
            await pool.query(
                'INSERT INTO admins (email, password, name) VALUES ($1, $2, $3)',
                [NEW_ADMIN_EMAIL, hashedPassword, 'Admin']
            );
            console.log(`✓ Created new admin ${NEW_ADMIN_EMAIL}\n`);
        }

        // Show updated admins
        console.log('📋 Updated admins:');
        const updatedAdmins = await pool.query('SELECT id, email, name FROM admins');
        updatedAdmins.rows.forEach(admin => {
            console.log(`  - ${admin.email} (ID: ${admin.id})`);
        });

        console.log('\n✅ Admin credentials updated successfully!\n');
        console.log('New credentials:');
        console.log(`  Email: ${NEW_ADMIN_EMAIL}`);
        console.log(`  Password: ${NEW_ADMIN_PASSWORD}`);
        console.log('\n⚠️  Save these credentials in a secure place!\n');

        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error);
        await pool.end();
        process.exit(1);
    }
}

updateAdmin();

