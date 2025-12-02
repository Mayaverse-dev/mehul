// Shipping zones and rates configuration
// Adjust these based on your actual shipping costs

const shippingZones = {
    domestic: ['US'],
    zone1: ['CA', 'MX'],
    zone2: ['GB', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI', 'AT', 'CH', 'IE', 'PT', 'GR', 'PL'], // Europe
    zone3: ['AU', 'NZ', 'JP', 'KR', 'SG', 'HK', 'TW'], // Asia-Pacific
    zone4: [] // Rest of world (default)
};

const shippingRates = {
    domestic: {
        base: 5,      // Base shipping cost in USD
        perItem: 2,   // Additional cost per item
        perGram: 0    // Additional cost per gram (if needed)
    },
    zone1: {
        base: 15,
        perItem: 5,
        perGram: 0
    },
    zone2: {
        base: 20,
        perItem: 7,
        perGram: 0
    },
    zone3: {
        base: 25,
        perItem: 10,
        perGram: 0
    },
    zone4: {
        base: 30,
        perItem: 12,
        perGram: 0
    }
};

module.exports = {
    shippingZones,
    shippingRates
};









