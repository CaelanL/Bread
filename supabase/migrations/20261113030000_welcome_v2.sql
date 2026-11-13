-- The 2.0 "What's new in Bread" walkthrough shows once per account, to accounts from before this
-- migration. Null means not yet shown. The app claims it with one update that sets it only while
-- it's null, and shows the walkthrough only when that update returns the row.
alter table public.profiles add column welcome_v2_seen_at timestamptz;

-- Profiles are written by the app, and released clients never wrote one, so most existing
-- accounts have no row. Give each one a row now, unseen: the app later fills in the translation
-- the same way as for a missing row.
insert into public.profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- Accounts made from here on start as seen.
alter table public.profiles alter column welcome_v2_seen_at set default now();
