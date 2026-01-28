require('dotenv').config();
const emailService = require('../services/emailService');

async function sendTestMagicLink() {
    try {
        const testEmail = 'mehulya24@gmail.com';
        
        // Generate a test magic link (using production URL)
        const appUrl = 'https://store.entermaya.com';
        const testToken = 'test-magic-link-token-' + Date.now();
        const magicLink = `${appUrl}/auth/magic?token=${testToken}`;
        
        console.log('Sending test magic link email to:', testEmail);
        console.log('Magic link:', magicLink);
        
        const result = await emailService.sendMagicLink(testEmail, magicLink);
        
        if (result.success) {
            console.log('\n✅ Test magic link email sent successfully!');
            console.log('  Email sent to:', testEmail);
            console.log('  Message ID:', result.messageId);
            console.log('\nNote: The magic link in this test email is not functional.');
            console.log('It is only for visual testing of the email design.');
        } else {
            console.error('\n❌ Failed to send test email:', result.error);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error sending test magic link email:', error);
        process.exit(1);
    }
}

sendTestMagicLink();

