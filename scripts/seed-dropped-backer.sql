-- Seed dropped backer test user
-- Email: mehulya24@gmail.com
-- PIN: 1234 (bcrypt hash)
-- Pledge: The Humble Vaanar ($18)
-- Addon: Lorebook
-- Status: dropped (payment failed)

-- Check if user exists and update, otherwise insert
INSERT INTO users (
    email, 
    password, 
    backer_number, 
    backer_uid, 
    backer_name,
    reward_title, 
    backing_minimum, 
    pledge_amount,
    kickstarter_items, 
    kickstarter_addons, 
    pledged_status
) VALUES (
    'mehulya24@gmail.com',
    '$2b$10$krXkUrbDSgd1O6.zpxfBlePgAyBtfpX3sEpqGY0P4QNj4iWRpJ9Lq', -- test123
    99999,
    'test-uid-' || substr(md5(random()::text), 1, 16),
    'Test Dropped Backer',
    'The Humble Vaanar',
    18,
    18,
    '{"ebook":1}'::jsonb,
    '{"lorebook_addon":1}'::jsonb,
    'dropped'
)
ON CONFLICT (email) DO UPDATE SET
    backer_number = EXCLUDED.backer_number,
    backer_uid = EXCLUDED.backer_uid,
    backer_name = EXCLUDED.backer_name,
    reward_title = EXCLUDED.reward_title,
    backing_minimum = EXCLUDED.backing_minimum,
    pledge_amount = EXCLUDED.pledge_amount,
    kickstarter_items = EXCLUDED.kickstarter_items,
    kickstarter_addons = EXCLUDED.kickstarter_addons,
    pledged_status = EXCLUDED.pledged_status;

-- Verify the user was created
SELECT 
    email,
    reward_title,
    pledge_amount,
    pledged_status,
    kickstarter_items,
    kickstarter_addons
FROM users 
WHERE email = 'mehulya24@gmail.com';

