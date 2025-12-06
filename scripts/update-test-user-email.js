require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

const testEmail = 'mehul.entermaya@gmail.com';

async function updateTestUserEmail() {
    if (process.env.DATABASE_URL) {
        // PostgreSQL
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });

        try {
            const result = await pool.query(
                `UPDATE users SET email = $1 WHERE email LIKE '%test%' OR email LIKE '%mehul%' OR backer_number = 9999 RETURNING id, email, backer_name`,
                [testEmail]
            );
            
            if (result.rows.length > 0) {
                console.log('✅ Updated test user email in PostgreSQL:');
                result.rows.forEach(row => {
                    console.log(`   - ID: ${row.id}, Email: ${row.email}, Name: ${row.backer_name}`);
                });
            } else {
                // Try to find any user and update
                const findResult = await pool.query('SELECT id, email FROM users LIMIT 1');
                if (findResult.rows.length > 0) {
                    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [testEmail, findResult.rows[0].id]);
                    console.log(`✅ Updated user ${findResult.rows[0].id} email to ${testEmail}`);
                } else {
                    console.log('⚠️  No users found in database');
                }
            }
            await pool.end();
        } catch (error) {
            console.error('❌ Error updating PostgreSQL:', error);
            process.exit(1);
        }
    } else {
        // SQLite
        const db = new sqlite3.Database('./database.db', (err) => {
            if (err) {
                console.error('❌ Error opening database:', err);
                process.exit(1);
            }
        });

        db.run(
            `UPDATE users SET email = ? WHERE email LIKE '%test%' OR email LIKE '%mehul%' OR backer_number = 9999`,
            [testEmail],
            function(err) {
                if (err) {
                    console.error('❌ Error updating SQLite:', err);
                } else {
                    if (this.changes > 0) {
                        console.log(`✅ Updated ${this.changes} user(s) email to ${testEmail}`);
                    } else {
                        // Try to update first user
                        db.get('SELECT id, email FROM users LIMIT 1', (err, row) => {
                            if (row) {
                                db.run('UPDATE users SET email = ? WHERE id = ?', [testEmail, row.id], (err) => {
                                    if (err) {
                                        console.error('❌ Error:', err);
                                    } else {
                                        console.log(`✅ Updated user ${row.id} email to ${testEmail}`);
                                    }
                                    db.close();
                                });
                            } else {
                                console.log('⚠️  No users found in database');
                                db.close();
                            }
                        });
                        return;
                    }
                }
                db.close();
            }
        );
    }
}

updateTestUserEmail();

