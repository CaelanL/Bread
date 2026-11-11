-- The account translation is owner-only, and words mastered count a verse once across translations.
-- Uses the seed logins. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);

set local role authenticated;

select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select lives_ok(
  format($$insert into public.profiles (user_id, translation) values (%L, 'NIV')$$, current_setting('test.reader_a')),
  'Reader A saves their translation');
select lives_ok($$update public.profiles set translation = 'KJV'$$, 'Reader A changes their translation');
select is((select translation from public.profiles), 'KJV', 'Reader A reads their translation');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select is((select count(*)::int from public.profiles), 0, 'Reader B cannot read reader A''s profile');
select throws_ok(
  format($$insert into public.profiles (user_id, translation) values (%L, 'ESV')$$, current_setting('test.reader_a')),
  '42501', null, 'Reader B cannot create a profile for reader A');
select lives_ok($$update public.profiles set translation = 'ESV'$$, 'Reader B updates profiles');

reset role;
select is((select translation from public.profiles where user_id = current_setting('test.reader_a')::uuid), 'KJV',
  'Reader A''s translation is unchanged');

set local role anon;
select throws_ok($$select * from public.profiles$$, '42501', null, 'Anonymous clients cannot read profiles');
reset role;

-- Reader B masters John 3:16 in ESV, then again after switching to NIV.
insert into public.session_attempts (user_id, book, chapter, verse_start, verse_end, version, difficulty, chunk_size, accuracy, recording_duration_ms, word_count, created_at)
values
  (current_setting('test.reader_b')::uuid, 'John', 3, 16, 16, 'ESV', 'hard', 1, 92, 30000, 25, now() - interval '2 days'),
  (current_setting('test.reader_b')::uuid, 'John', 3, 16, 16, 'NIV', 'hard', 1, 95, 30000, 26, now() - interval '1 day');
select public.update_user_stats();
select is((select total_words_mastered from public.user_stats where user_id = current_setting('test.reader_b')::uuid), 25,
  'A verse mastered in two translations counts its words once');

select * from finish();
rollback;
