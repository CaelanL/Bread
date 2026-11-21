-- The welcome walkthrough's once-per-account claim on profiles.welcome_v2_seen_at. Uses fresh
-- accounts made here, so drifted seed data can't change the result. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select set_config('test.old', 'e0000000-0000-4000-8000-000000000011', true);
select set_config('test.new', 'e0000000-0000-4000-8000-000000000012', true);
insert into auth.users (id, email) values
  (current_setting('test.old')::uuid, 'welcome-old@example.test'),
  (current_setting('test.new')::uuid, 'welcome-new@example.test');
-- An account from before the migration: its backfilled row is unseen.
insert into public.profiles (user_id, welcome_v2_seen_at) values (current_setting('test.old')::uuid, null);

select col_is_null('public', 'profiles', 'welcome_v2_seen_at', 'the column is nullable, for old clients');

-- The app's claim, as lib/welcome.ts makes it: set it only while null; a row back means show it.
create function pg_temp.claim(uid uuid) returns int language sql as $$
  with c as (update public.profiles set welcome_v2_seen_at = now() where user_id = uid and welcome_v2_seen_at is null returning 1)
  select count(*)::int from c
$$;

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('test.old'), true);
select is(pg_temp.claim(current_setting('test.old')::uuid), 1, 'an unseen account claims the walkthrough');
select is(pg_temp.claim(current_setting('test.old')::uuid), 0, 'a second claim, from another device or launch, gets nothing');

select set_config('request.jwt.claim.sub', current_setting('test.new'), true);
select lives_ok(format($$insert into public.profiles (user_id, translation) values (%L, 'ESV')$$, current_setting('test.new')),
  'a new account''s first profile write succeeds');
select isnt((select welcome_v2_seen_at from public.profiles), null, 'a new account starts as seen');
select is(pg_temp.claim(current_setting('test.new')::uuid), 0, 'a new account never claims it');

reset role;
update public.profiles set welcome_v2_seen_at = null where user_id = current_setting('test.old')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.new'), true);
select is(pg_temp.claim(current_setting('test.old')::uuid), 0, 'another account can''t claim an unseen walkthrough');

set local role anon;
select throws_ok($$update public.profiles set welcome_v2_seen_at = now()$$, '42501', null, 'signed out, nothing is claimed');

select * from finish();
rollback;
