/**
 * Seed Changelog from PLEDGE MANAGER CHANGELOG.md
 */

const fs = require('fs');
const path = require('path');
const { initConnection, execute, closeConnections } = require('../config/database');

// Simple markdown to HTML converter
function markdownToHtml(markdown) {
    let html = markdown
        // Headers
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Italic
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        // Lists
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        // Links
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
        // Code
        .replace(/`(.+?)`/g, '<code>$1</code>');
    
    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*<\/li>\n?)+/gs, match => `<ul>${match}</ul>`);
    
    // Paragraphs (lines that aren't already wrapped)
    html = html.split('\n').map(line => {
        line = line.trim();
        if (!line) return '';
        if (line.startsWith('<')) return line;
        return `<p>${line}</p>`;
    }).join('\n');
    
    return html;
}

// Parse the changelog markdown file
function parseChangelog(content) {
    const entries = [];
    const lines = content.split('\n');
    let currentEntry = null;
    let bodyLines = [];
    
    for (const line of lines) {
        // Match version header: ## [1.4.0] - 2026-02-03
        const versionMatch = line.match(/^## \[(.+?)\] - (\d{4}-\d{2}-\d{2})/);
        
        if (versionMatch) {
            // Save previous entry
            if (currentEntry) {
                currentEntry.body = bodyLines.join('\n').trim();
                entries.push(currentEntry);
            }
            
            // Start new entry
            currentEntry = {
                version: versionMatch[1],
                date: versionMatch[2],
                title: `Version ${versionMatch[1]}`,
                tags: []
            };
            bodyLines = [];
        } else if (currentEntry && line.startsWith('### ')) {
            // Section headers become tags
            const section = line.replace('### ', '').toLowerCase();
            if (section === 'added') currentEntry.tags.push('feature');
            else if (section === 'fixed') currentEntry.tags.push('fix');
            else if (section === 'changed') currentEntry.tags.push('update');
            else if (section === 'breaking') currentEntry.tags.push('breaking');
            bodyLines.push(line);
        } else if (currentEntry && line.trim() && !line.startsWith('#') && !line.startsWith('---')) {
            bodyLines.push(line);
        }
    }
    
    // Save last entry
    if (currentEntry) {
        currentEntry.body = bodyLines.join('\n').trim();
        entries.push(currentEntry);
    }
    
    return entries;
}

async function seedChangelog() {
    console.log('\n=== Seeding Pledge Manager Changelog ===\n');
    
    try {
        initConnection();
        
        // Wait for database to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Read the changelog file
        const changelogPath = path.join(__dirname, '..', 'PLEDGE MANAGER CHANGELOG.md');
        const content = fs.readFileSync(changelogPath, 'utf-8');
        
        // Parse entries
        const entries = parseChangelog(content);
        console.log(`Found ${entries.length} changelog entries\n`);
        
        // Insert each entry
        for (const entry of entries) {
            console.log(`Adding: ${entry.title} (${entry.date})`);
            
            await execute(
                'INSERT INTO changelogs (slug, title, body, tags, published_at) VALUES ($1, $2, $3, $4, $5)',
                [
                    'Pledgemanager',
                    entry.title,
                    entry.body,
                    entry.tags.join(','),
                    entry.date
                ]
            );
        }
        
        console.log('\n✓ Changelog seeded successfully!\n');
        
    } catch (err) {
        console.error('Error seeding changelog:', err);
        process.exit(1);
    } finally {
        await closeConnections();
        process.exit(0);
    }
}

seedChangelog();
