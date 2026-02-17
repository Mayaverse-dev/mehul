/**
 * Markdown to HTML Converter
 * Simple converter for changelog entries
 */

function markdownToHtml(markdown) {
    if (!markdown) return '';
    
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
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>')
        // Code
        .replace(/`(.+?)`/g, '<code>$1</code>');
    
    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*?<\/li>\s*)+/gs, match => `<ul>${match}</ul>`);
    
    // Paragraphs (lines that aren't already wrapped in HTML tags)
    const lines = html.split('\n');
    const processed = [];
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        // Skip if already HTML
        if (line.startsWith('<')) {
            processed.push(line);
        } else {
            processed.push(`<p>${line}</p>`);
        }
    }
    
    return processed.join('\n');
}

module.exports = { markdownToHtml };
