-- One phone, two accounts: the token row belongs to whoever registered it last.
-- Uses the seed logins. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select lives_ok($$select public.register_device_token('ExponentPushToken[shared-phone]', 'ios')$$, 'Reader A registers the phone');

-- A signs out without the row being removed (app killed), then B signs in on the same phone.
select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select lives_ok($$select public.register_device_token('ExponentPushToken[shared-phone]', 'ios')$$, 'Reader B registers the same phone');

reset role;
select is(
  (select user_id::text from public.device_tokens where expo_token = 'ExponentPushToken[shared-phone]'),
  current_setting('test.reader_b'),
  'The phone''s row is reader B''s'
);
select is(
  (select count(*)::int from public.device_tokens where user_id = current_setting('test.reader_a')::uuid),
  0,
  'Reader A has no row left, so A''s reminders no longer reach the phone'
);

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.register_device_token('ExponentPushToken[shared-phone]', 'ios')$$, '42501', null, 'A signed-out caller cannot register a token');

select * from finish();
rollback;
