-- The account translation is owner-only, and words mastered count a verse once across translations.
-- Uses the seed logins. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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

-- Only the owner can delete a verse (collapse and removing an unmastered verse hard-delete).
select set_config('test.a_verse', (select id::text from public.user_verses
  where user_id = current_setting('test.reader_a')::uuid order by id limit 1), true);
set local role anon;
delete from public.user_verses where id = current_setting('test.a_verse')::uuid;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
delete from public.user_verses where id = current_setting('test.a_verse')::uuid;
reset role;
select is((select count(*)::int from public.user_verses where id = current_setting('test.a_verse')::uuid), 1,
  'Reader B and anonymous clients cannot delete reader A''s verse');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select lives_ok(format($$delete from public.user_verses where id = %L$$, current_setting('test.a_verse')),
  'Reader A deletes their own verse');
reset role;
select is((select count(*)::int from public.user_verses where id = current_setting('test.a_verse')::uuid), 0,
  'Reader A''s deleted verse is gone');

-- Reader B had an estimate when the same verse counted twice; now it counts once.
insert into public.user_stats (user_id, avg_time_per_word_ms, total_words_mastered)
values (current_setting('test.reader_b')::uuid, 1234, 700);

-- Reader B masters John 3:16 in ESV, then again after switching to NIV.
insert into public.session_attempts (user_id, book, chapter, verse_start, verse_end, version, difficulty, chunk_size, accuracy, recording_duration_ms, word_count, created_at)
values
  (current_setting('test.reader_b')::uuid, 'John', 3, 16, 16, 'ESV', 'hard', 1, 92, 30000, 25, now() - interval '2 days'),
  (current_setting('test.reader_b')::uuid, 'John', 3, 16, 16, 'NIV', 'hard', 1, 95, 30000, 26, now() - interval '1 day');
select public.update_user_stats();
select is((select total_words_mastered from public.user_stats where user_id = current_setting('test.reader_b')::uuid), 25,
  'A verse mastered in two translations counts its words once');
select is((select avg_time_per_word_ms from public.user_stats where user_id = current_setting('test.reader_b')::uuid), null,
  'An estimate below the threshold after deduplication is cleared');

select * from finish();
rollback;
