/**
 * Add Book One Changelog Entry - Private
 */

const { initConnection, execute, closeConnections } = require('../config/database');

async function addBookOneChangelog() {
    console.log('\n=== Adding Book One Changelog ===\n');
    
    try {
        initConnection();
        
        // Wait for database to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const entry = {
            slug: 'ebook/MAYA-book-one',
            title: 'Typography Update',
            body: '### Fixed\n- Fixed typographical error on back cover',
            tags: 'fix',
            published_at: new Date().toISOString().slice(0, 10),
            is_public: 0 // Private
        };
        
        console.log(`Adding private changelog for Book One...`);
        console.log(`Title: ${entry.title}`);
        console.log(`Visibility: Private (admin only)`);
        
        await execute(
            'INSERT INTO changelogs (slug, title, body, tags, is_public, published_at) VALUES ($1, $2, $3, $4, $5, $6)',
            [entry.slug, entry.title, entry.body, entry.tags, entry.is_public, entry.published_at]
        );
        
        console.log('\n✓ Book One changelog added successfully!\n');
        console.log('This entry is PRIVATE and will only be visible to admins.\n');
        
    } catch (err) {
        console.error('Error adding changelog:', err);
        process.exit(1);
    } finally {
        await closeConnections();
        process.exit(0);
    }
}

addBookOneChangelog();
