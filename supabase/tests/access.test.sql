-- Reader B can't read or write reader A's verses, progress, collections or stats.
-- Uses the seed logins. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.a_collection', (select id::text from public.user_collections where client_id = 'my-verses' and user_id = current_setting('test.reader_a')::uuid), true);
select set_config('test.a_verse', (select id::text from public.user_verses where client_id = 'seed-john-3-16'), true);

set local role authenticated;

-- Reader A sees their own data, so the zeros below mean something.
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select is((select count(*)::int from public.user_verses), 3, 'Reader A sees their verses');
select is((select count(*)::int from public.user_collections), 2, 'Reader A sees their collections');
select is((select count(*)::int from public.session_attempts), 6, 'Reader A sees their attempts');

-- Reader B reads nothing of reader A's.
select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select is((select count(*)::int from public.user_verses), 0, 'Reader B gets no verses of reader A');
select is((select count(*)::int from public.user_collections), 0, 'Reader B gets no collections of reader A');
select is((select count(*)::int from public.verse_collections), 0, 'Reader B gets no verse links of reader A');
select is((select count(*)::int from public.session_attempts), 0, 'Reader B gets no attempts of reader A');
select is((select count(*)::int from public.user_stats), 0, 'Reader B gets no stats of reader A');

-- Reader B can't add rows as reader A.
select throws_ok(
  format($$insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version) values (%L, 'b', 'John', 1, 1, 1, 'ESV')$$, current_setting('test.reader_a')),
  '42501', null, 'Reader B cannot add a verse for reader A');
select throws_ok(
  format($$insert into public.user_collections (user_id, client_id, name) values (%L, 'b', 'B')$$, current_setting('test.reader_a')),
  '42501', null, 'Reader B cannot add a collection for reader A');
select throws_ok(
  format($$insert into public.verse_collections (verse_id, collection_id) values (%L, %L)$$, current_setting('test.a_verse'), current_setting('test.a_collection')),
  '42501', null, 'Reader B cannot link reader A''s verse');
select throws_ok(
  format($$insert into public.session_attempts (user_id, book, chapter, verse_start, verse_end, version, difficulty, chunk_size, accuracy) values (%L, 'John', 1, 1, 1, 'ESV', 'easy', 1, 100)$$, current_setting('test.reader_a')),
  '42501', null, 'Reader B cannot add an attempt for reader A');

-- Reader B's updates and deletes reach no rows of reader A's.
select lives_ok($$update public.user_verses set progress = '{}'::jsonb$$, 'Reader B updates verses');
select lives_ok($$update public.user_collections set name = 'taken'$$, 'Reader B updates collections');
select lives_ok($$delete from public.verse_collections$$, 'Reader B deletes verse links');

reset role;
select is((select count(*)::int from public.user_verses where progress = '{}'::jsonb), 0, 'Reader A''s progress is unchanged');
select is((select count(*)::int from public.user_collections where name = 'taken'), 0, 'Reader A''s collections are unchanged');
select is((select count(*)::int from public.verse_collections vc join public.user_verses v on v.id = vc.verse_id
  where v.user_id = current_setting('test.reader_a')::uuid), 3, 'Reader A''s verse links are all there');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);

-- The stats functions answer only for the caller.
select is(public.get_current_streak(current_setting('test.reader_a')::uuid, 0), 0, 'Reader B cannot read reader A''s streak');
select is(public.get_total_time_studied(current_setting('test.reader_a')::uuid), 0::bigint, 'Reader B cannot read reader A''s study time');
insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version)
values (current_setting('test.reader_b')::uuid, 'b-own', 'John', 1, 1, 1, 'ESV');
select throws_ok(
  format($$insert into public.verse_collections (verse_id, collection_id)
    select v.id, %L from public.user_verses v where v.client_id = 'b-own'$$,
    current_setting('test.a_collection')),
  '42501', null, 'Reader B cannot put their own verse in reader A''s collection');

-- Old clients pass their own id and keep getting their own numbers (the seed's 5-day streak).
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select is(public.get_current_streak(current_setting('test.reader_a')::uuid, 0), 5, 'Reader A reads their own streak');
select ok(public.get_total_time_studied(current_setting('test.reader_a')::uuid) > 0, 'Reader A reads their own study time');
reset role;

select ok(not has_function_privilege('authenticated', 'public.update_popular_ranges()', 'EXECUTE'), 'Clients cannot run update_popular_ranges');
select ok(not has_function_privilege('authenticated', 'public.update_user_stats()', 'EXECUTE'), 'Clients cannot run update_user_stats');
select ok(not has_function_privilege('anon', 'public.delete_own_account()', 'EXECUTE'), 'Anonymous calls cannot reach delete_own_account');
select ok(not has_function_privilege('anon', 'public.get_current_streak(uuid,integer)', 'EXECUTE'), 'Anonymous calls cannot read streaks');
select is(
  array(
    select sig from unnest(array[
      'public.cleanup_stale_transcription_locks()', 'public.cleanup_expired_verse_cache()',
      'public.get_verse_cache_count(text)', 'public.evict_lru_verses(text,integer,integer)',
      'public.upsert_verses(text,integer,text,jsonb)'
    ]) as sig
    where to_regprocedure(sig) is not null
      and (has_function_privilege('anon', sig, 'EXECUTE') or has_function_privilege('authenticated', sig, 'EXECUTE'))
  ),
  array[]::text[],
  'clients cannot run the legacy cache and lock functions'
);
select is((select confdeltype from pg_constraint where conname = 'session_attempts_user_id_fkey'), 'c'::"char",
  'a user''s attempts go with them');

select * from finish();
rollback;
