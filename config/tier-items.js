// Canonical mapping of pledge tiers to included items, item display names,
// and KS addon key normalisation.  Every server-side and client-facing consumer
// should import from here instead of maintaining its own copy.

// ── Tier hierarchy (rank order for upgrade eligibility) ─────────────────────
const TIER_HIERARCHY = {
    'The Humble Vaanar':        1,
    'The Industrious Manushya': 2,
    'The Resplendent Garuda':   3,
    'The Benevolent Divya':     4,
    'Founders of Neh':          5
};

// ── Items included with each pledge tier ────────────────────────────────────
const TIER_ITEMS = {
    'The Humble Vaanar':        ['ebook', 'paperback'],
    'The Industrious Manushya': ['ebook', 'hardcover'],
    'The Resplendent Garuda':   ['ebook', 'hardcover', 'audiobook', 'lorebook', 'built_env'],
    'The Benevolent Divya':     ['ebook', 'hardcover', 'audiobook', 'lorebook', 'built_env', 'pendant', 'book2_hardcover', 'book3_hardcover', 'book2_live', 'book3_live'],
    'Founders of Neh':          ['ebook', 'hardcover', 'audiobook', 'lorebook', 'built_env', 'pendant', 'book2_hardcover', 'book3_hardcover', 'book2_live', 'book3_live', 'art_book']
};

// ── Internal key → short display name (reports, spreadsheets) ───────────────
const ITEM_NAMES_SHORT = {
    ebook:           'Ebook',
    paperback:       'Paperback',
    hardcover:       'Hardcover',
    audiobook:       'Audiobook',
    lorebook:        'Lorebook',
    built_env:       'Built Environments',
    pendant:         'Pendant',
    book2_hardcover: 'Book 2 Hardcover',
    book3_hardcover: 'Book 3 Hardcover',
    book2_live:      'Book 2 Live Access',
    book3_live:      'Book 3 Live Access',
    art_book:        'Art Book'
};

// ── Internal key → full display name (customer-facing UI) ───────────────────
const ITEM_NAMES = {
    ebook:           'MAYA : Seed Takes Root e-book (Edition Zero)',
    paperback:       'MAYA : Seed Takes Root Paperback (Edition Zero)',
    audiobook:       'MAYA : Seed Takes Root Audiobook (Narrated by Hugo Weaving)',
    hardcover:       'MAYA : Seed Takes Root Hardcover (Edition Zero)',
    book2_hardcover: 'MAYA : Whispers In The Soil | Book 2 Hardcover',
    book3_hardcover: 'MAYA : It Becomes The Forest | Book 3 Hardcover',
    book2_live:      'MAYA : Whispers In The Soil | Book 2 Live Access',
    book3_live:      'MAYA : It Becomes The Forest | Book 3 Live Access',
    lorebook:        'MAYA Lore : It\'s Species And Their Cultures (Edition Zero)',
    built_env:       'Built Environments of MAYA Hardcover (Phase 1 & 2)',
    pendant:         'Flitt Locust Pendant',
    art_book:        'Limited Edition MAYA Art Book'
};

// ── KS addon keys (DB / CSV variants) → canonical display name ──────────────
// Covers short keys (pendant, audiobook_addon, …), alternate short keys
// (audiobook, built_env, lorebook), and full-name strings that may appear in
// older records.
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

// ── KS addon keys → short display names (for dashboard "KS Addons" section) ─
const ADDON_NAMES_SHORT = {
    pendant:         'Flitt Locust Pendant',
    audiobook_addon: 'MAYA: Seed Takes Root Audiobook',
    built_env_addon: 'Built Environments of MAYA Hardcover',
    lorebook_addon:  'MAYA Lorebook'
};

// ── KS addon key → canonical item key (for dedup / counting) ────────────────
// Maps every variant key to the base item key used in ITEM_NAMES.
const ADDON_KEY_MAP = {
    'pendant':                                'pendant',
    'audiobook_addon':                        'audiobook',
    'audiobook':                              'audiobook',
    'built_env_addon':                        'built_env',
    'built_env':                              'built_env',
    'lorebook_addon':                         'lorebook',
    'lorebook':                               'lorebook',
    'Flitt Locust Pendant':                   'pendant',
    'MAYA: Seed Takes Root Audiobook':        'audiobook',
    'Built Environments of MAYA Hardcover':   'built_env',
    'MAYA Lorebook':                          'lorebook'
};

// ── Dropped backer addon prices (backer price when re-purchasing) ────────────
const ADDON_BACKER_PRICES = {
    'Flitt Locust Pendant':                 15,
    'MAYA: Seed Takes Root Audiobook':       20,
    'Built Environments of MAYA Hardcover':  25,
    'MAYA Lorebook':                         25
};

// ── CSV column → internal key (for import-csv.js and update-late-backers) ────
const CSV_ITEM_COLUMNS = {
    'MAYA : Seed Takes Root ebook (Edition Zero)':                  'ebook',
    'MAYA : Seed Takes Root Paperback (Edition Zero)':              'paperback',
    'MAYA : Seed Takes Root Audiobook (Narrated by Hugo Weaving)':  'audiobook',
    'MAYA : Seed Takes Root Hardcover (Edition Zero)':              'hardcover',
    'MAYA : Whispers In The Soil | Book 2 Hardcover':               'book2_hardcover',
    'MAYA : It Becomes The Forest | Book 3 Hardcover':              'book3_hardcover',
    'MAYA Lore : It\'s Species And Their Cultures (Edition Zero)':  'lorebook',
    'Built Environments of MAYA Hardcover (Phase 1 & 2)':           'built_env',
    'Flitt Locust Pendant':                                         'pendant',
    'Limited Edition MAYA Art Book':                                 'art_book',
    'MAYA : Whispers In The Soil | Book 2 Live Access':             'book2_live',
    'MAYA : It Becomes The Forest | Book 3 Live Access':            'book3_live'
};

const CSV_ADDON_COLUMNS = {
    '[Addon: 10750435] Flitt Locust Pendant':                       'pendant',
    '[Addon: 10750413] MAYA: Seed Takes Root Audiobook':            'audiobook_addon',
    '[Addon: 10753939] Built Environments of MAYA Hardcover':       'built_env_addon',
    '[Addon: 10753941] MAYA Lorebook':                              'lorebook_addon'
};

module.exports = {
    TIER_HIERARCHY,
    TIER_ITEMS,
    ITEM_NAMES_SHORT,
    ITEM_NAMES,
    ADDON_NAME_MAP,
    ADDON_NAMES_SHORT,
    ADDON_KEY_MAP,
    ADDON_BACKER_PRICES,
    CSV_ITEM_COLUMNS,
    CSV_ADDON_COLUMNS
};
