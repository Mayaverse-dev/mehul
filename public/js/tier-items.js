// Client-side mirror of config/tier-items.js
// Auto-consumed by dashboard.html, addons.html, shipping.html via <script> tag.
// Keep in sync with the server-side config — this IS the single source of truth
// for the browser; the Node config is the source of truth for the server.

window.TierItems = (() => {
    const TIER_HIERARCHY = {
        'The Humble Vaanar':        1,
        'The Industrious Manushya': 2,
        'The Resplendent Garuda':   3,
        'The Benevolent Divya':     4,
        'Founders of Neh':          5
    };

    const TIER_ITEMS = {
        'The Humble Vaanar':        ['ebook', 'paperback'],
        'The Industrious Manushya': ['ebook', 'hardcover'],
        'The Resplendent Garuda':   ['ebook', 'hardcover', 'audiobook', 'lorebook', 'built_env'],
        'The Benevolent Divya':     ['ebook', 'hardcover', 'audiobook', 'lorebook', 'built_env', 'pendant', 'book2_hardcover', 'book3_hardcover', 'book2_live', 'book3_live'],
        'Founders of Neh':          ['ebook', 'hardcover', 'audiobook', 'lorebook', 'built_env', 'pendant', 'book2_hardcover', 'book3_hardcover', 'book2_live', 'book3_live', 'art_book']
    };

    const ITEM_NAMES = {
        ebook:           'MAYA : Seed Takes Root e-book (Edition Zero)',
        paperback:       'MAYA : Seed Takes Root Paperback (Edition Zero)',
        audiobook:       'MAYA : Seed Takes Root Audiobook (Narrated by Hugo Weaving)',
        hardcover:       'MAYA : Seed Takes Root Hardcover (Edition Zero)',
        book2_hardcover: 'MAYA : Whispers In The Soil | Book 2 Hardcover',
        book3_hardcover: 'MAYA : It Becomes The Forest | Book 3 Hardcover',
        book2_live:      'MAYA : Whispers In The Soil | Book 2 Live Access',
        book3_live:      'MAYA : It Becomes The Forest | Book 3 Live Access',
        lorebook:        "MAYA Lore : It's Species And Their Cultures (Edition Zero)",
        built_env:       'Built Environments of MAYA Hardcover (Phase 1 & 2)',
        pendant:         'Flitt Locust Pendant',
        art_book:        'Limited Edition MAYA Art Book'
    };

    const ADDON_NAME_MAP = {
        'pendant':                                'Flitt Locust Pendant',
        'audiobook_addon':                        'MAYA: Seed Takes Root Audiobook',
        'audiobook':                              'MAYA: Seed Takes Root Audiobook',
        'built_env_addon':                        'Built Environments of MAYA Hardcover',
        'built_env':                              'Built Environments of MAYA Hardcover',
        'lorebook_addon':                         'MAYA Lorebook',
        'lorebook':                               'MAYA Lorebook',
        'Flitt Locust Pendant':                   'Flitt Locust Pendant',
        'MAYA: Seed Takes Root Audiobook':        'MAYA: Seed Takes Root Audiobook',
        'Built Environments of MAYA Hardcover':   'Built Environments of MAYA Hardcover',
        'MAYA Lorebook':                          'MAYA Lorebook'
    };

    const ADDON_NAMES_SHORT = {
        pendant:         'Flitt Locust Pendant',
        audiobook_addon: 'MAYA: Seed Takes Root Audiobook',
        built_env_addon: 'Built Environments of MAYA Hardcover',
        lorebook_addon:  'MAYA Lorebook'
    };

    const ADDON_BACKER_PRICES = {
        'Flitt Locust Pendant':                 15,
        'MAYA: Seed Takes Root Audiobook':       20,
        'Built Environments of MAYA Hardcover':  25,
        'MAYA Lorebook':                         25
    };

    return {
        TIER_HIERARCHY,
        TIER_ITEMS,
        ITEM_NAMES,
        ADDON_NAME_MAP,
        ADDON_NAMES_SHORT,
        ADDON_BACKER_PRICES
    };
})();
