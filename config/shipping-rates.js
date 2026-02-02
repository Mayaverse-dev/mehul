// Shipping matrix derived from provided CSVs:
// - "Shipping per country (in $) - Sheet1.csv"
// - "EU zone countries - Sheet1.csv"
//
// Zones are keyed by exact country rows in the shipping CSV. EU zones are
// expanded using the second CSV. Country matching is done by display name.

// Pledge keys
const PLEDGES = [
    'humble vaanar',
    'industrious manushya',
    'resplendent garuda',
    'benevolent divya',
    'founders of neh'
];

// Add-on keys we price separately
const ADDONS = {
    'built environments': 'Built Environments',
    'lorebook': 'Lorebook',
    'paperback': 'Paperback',
    'hardcover': 'Hardcover'
};

// Base table (values in USD) as per shipping CSV
const shippingRates = {
    'USA': {
        pledges: { 'humble vaanar': 12, 'industrious manushya': 13, 'resplendent garuda': 42, 'benevolent divya': 50, 'founders of neh': 80 },
        addons: { 'Built Environments': 5, 'Lorebook': 5, 'Paperback': 5, 'Hardcover': 5 }
    },
    'CANADA': {
        pledges: { 'humble vaanar': 12, 'industrious manushya': 13, 'resplendent garuda': 42, 'benevolent divya': 50, 'founders of neh': 80 },
        addons: { 'Built Environments': 5, 'Lorebook': 5, 'Paperback': 5, 'Hardcover': 5 }
    },
    'MEXICO': {
        pledges: { 'humble vaanar': 12, 'industrious manushya': 13, 'resplendent garuda': 42, 'benevolent divya': 50, 'founders of neh': 80 },
        addons: { 'Built Environments': 5, 'Lorebook': 5, 'Paperback': 5, 'Hardcover': 5 }
    },
    'UK': {
        pledges: { 'humble vaanar': 11, 'industrious manushya': 13, 'resplendent garuda': 40, 'benevolent divya': 51, 'founders of neh': 80 },
        addons: { 'Built Environments': 5, 'Lorebook': 5, 'Paperback': 5, 'Hardcover': 5 }
    },
    'EU-1': {
        pledges: { 'humble vaanar': 13, 'industrious manushya': 13, 'resplendent garuda': 42, 'benevolent divya': 47, 'founders of neh': 80 },
        addons: { 'Built Environments': 6, 'Lorebook': 6, 'Paperback': 6, 'Hardcover': 6 }
    },
    'EU-2': {
        pledges: { 'humble vaanar': 15, 'industrious manushya': 15, 'resplendent garuda': 47, 'benevolent divya': 55, 'founders of neh': 100 },
        addons: { 'Built Environments': 7, 'Lorebook': 7, 'Paperback': 7, 'Hardcover': 7 }
    },
    'EU-3': {
        pledges: { 'humble vaanar': 16, 'industrious manushya': 19, 'resplendent garuda': 58, 'benevolent divya': 71, 'founders of neh': 100 },
        addons: { 'Built Environments': 8, 'Lorebook': 8, 'Paperback': 8, 'Hardcover': 8 }
    },
    'AUSTRALIA': {
        pledges: { 'humble vaanar': 13, 'industrious manushya': 16, 'resplendent garuda': 52, 'benevolent divya': 56, 'founders of neh': 90 },
        addons: { 'Built Environments': 8, 'Lorebook': 7, 'Paperback': 7, 'Hardcover': 7 }
    },
    'NEW ZEALAND': {
        pledges: { 'humble vaanar': 18, 'industrious manushya': 23, 'resplendent garuda': 72, 'benevolent divya': 92, 'founders of neh': 120 },
        addons: { 'Built Environments': 8, 'Lorebook': 8, 'Paperback': 8, 'Hardcover': 8 }
    },
    'CHINA / HONG KONG': {
        pledges: { 'humble vaanar': 8, 'industrious manushya': 10, 'resplendent garuda': 25, 'benevolent divya': 30, 'founders of neh': 60 },
        addons: { 'Built Environments': 5, 'Lorebook': 5, 'Paperback': 5, 'Hardcover': 5 }
    },
    'INDIA': {
        pledges: { 'humble vaanar': 5, 'industrious manushya': 5, 'resplendent garuda': 25, 'benevolent divya': 30, 'founders of neh': 50 },
        addons: { 'Built Environments': 4, 'Lorebook': 4, 'Paperback': 4, 'Hardcover': 4 }
    },
    'ASIA': {
        pledges: { 'humble vaanar': 12, 'industrious manushya': 20, 'resplendent garuda': 40, 'benevolent divya': 50, 'founders of neh': 80 },
        addons: { 'Built Environments': 10, 'Lorebook': 10, 'Paperback': 10, 'Hardcover': 10 }
    },
    'REST OF WORLD': {
        pledges: { 'humble vaanar': 20, 'industrious manushya': 25, 'resplendent garuda': 80, 'benevolent divya': 99, 'founders of neh': 120 },
        addons: { 'Built Environments': 10, 'Lorebook': 10, 'Paperback': 10, 'Hardcover': 10 }
    }
};

// EU zone expansion (from EU zone countries - Sheet1.csv)
const euZoneMap = {
    'EU-1': [
        'Austria','Belgium','Czech Republic','Denmark','France','Germany','Hungary','Ireland','Luxembourg','Netherlands','Poland','Portugal','Slovakia','Spain'
    ],
    'EU-2': [
        'Bulgaria','Croatia','Estonia','Finland','Greece','Italy','Latvia','Lithuania','Romania','Slovenia','Sweden'
    ],
    'EU-3': [
        'Malta','Monaco','Norway','San Marino','Switzerland','Andorra','Cyprus','Serbia','Turkey','Gibraltar'
    ]
};

// Asia zone countries (excludes China/HK, India which have separate zones; excludes Cyprus, Turkey which are EU-3)
const asiaCountries = [
    'United Arab Emirates', 'Afghanistan', 'Armenia', 'Azerbaijan', 'Bangladesh',
    'Bahrain', 'Brunei', 'Bhutan', 'Georgia', 'Indonesia', 'Israel', 'Iraq',
    'Iran', 'Jordan', 'Japan', 'Kyrgyzstan', 'Cambodia', 'North Korea',
    'South Korea', 'Kuwait', 'Kazakhstan', 'Laos', 'Lebanon', 'Sri Lanka',
    'Myanmar', 'Mongolia', 'Maldives', 'Malaysia', 'Nepal', 'Oman',
    'Philippines', 'Pakistan', 'Palestine', 'Qatar', 'Saudi Arabia',
    'Singapore', 'Syria', 'Thailand', 'Tajikistan', 'Timor-Leste',
    'Turkmenistan', 'Uzbekistan', 'Vietnam', 'Yemen'
];

// Country-to-zone mapping
const countryZone = (() => {
    const map = new Map();

    // Direct rows
    map.set('united states', 'USA');
    map.set('us', 'USA');
    map.set('usa', 'USA');

    map.set('canada', 'CANADA');
    map.set('mexico', 'MEXICO');
    map.set('united kingdom', 'UK');
    map.set('uk', 'UK');
    map.set('great britain', 'UK');
    map.set('england', 'UK');

    map.set('australia', 'AUSTRALIA');
    map.set('austraila', 'AUSTRALIA'); // handle typo from CSV
    map.set('new zealand', 'NEW ZEALAND');

    map.set('china', 'CHINA / HONG KONG');
    map.set('hong kong', 'CHINA / HONG KONG');
    map.set('china/ hong kong', 'CHINA / HONG KONG');

    map.set('india', 'INDIA');

    // EU zones
    Object.entries(euZoneMap).forEach(([zone, countries]) => {
        countries.forEach(c => map.set(c.toLowerCase(), zone));
    });

    // Asia zone
    asiaCountries.forEach(c => map.set(c.toLowerCase(), 'ASIA'));
    // Common variations
    map.set('uae', 'ASIA');
    map.set('korea', 'ASIA');
    map.set('south korea', 'ASIA');
    map.set('republic of korea', 'ASIA');

    return map;
})();

function resolveZone(countryName = '') {
    const key = countryName.trim().toLowerCase();
    return countryZone.get(key) || 'REST OF WORLD';
}

module.exports = {
    shippingRates,
    resolveZone,
    PLEDGES,
    ADDONS
};

