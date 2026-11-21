begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- reader-b starts empty. "List" holds a mastered verse also in "Kept", plus a mastered and an
-- unmastered verse held nowhere else.
select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.reader_d', (select id::text from auth.users where email = 'reader-d@example.test'), true);

insert into public.user_collections (id, user_id, client_id, name, is_default, created_at)
values
  ('b0000000-0000-4000-8000-0000000000a2', current_setting('test.reader_b')::uuid, 'list', 'List', false, now()),
  ('b0000000-0000-4000-8000-0000000000a3', current_setting('test.reader_b')::uuid, 'kept', 'Kept', false, now());

insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress)
values
  ('b0000000-0000-4000-8000-0000000000b1', current_setting('test.reader_b')::uuid, 'held-elsewhere', 'John', 1, 1, 1, 'ESV',
    '{"hard":{"bestAccuracy":95,"completed":true}}'),
  ('b0000000-0000-4000-8000-0000000000b2', current_setting('test.reader_b')::uuid, 'mastered-alone', 'John', 1, 2, 2, 'ESV',
    '{"hard":{"bestAccuracy":95,"completed":true}}'),
  ('b0000000-0000-4000-8000-0000000000b3', current_setting('test.reader_b')::uuid, 'learning-alone', 'John', 1, 3, 3, 'ESV',
    '{"hard":{"bestAccuracy":40,"completed":false}}');

insert into public.verse_collections (verse_id, collection_id)
values
  ('b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000a2'),
  ('b0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-0000000000a3'),
  ('b0000000-0000-4000-8000-0000000000b2', 'b0000000-0000-4000-8000-0000000000a2'),
  ('b0000000-0000-4000-8000-0000000000b3', 'b0000000-0000-4000-8000-0000000000a2');

select ok(not has_function_privilege('anon', 'public.delete_verse(text,text)', 'EXECUTE'),
  'anonymous API calls cannot delete verses');
select is((select prosecdef from pg_proc where oid = 'public.delete_verse(text,text)'::regprocedure), false,
  'delete_verse runs with caller privileges');

set local role authenticated;

-- Another account can't reach reader-b's collection or verses.
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select throws_ok($$select public.delete_verse('learning-alone', 'list')$$, '22023', null,
  'another account gets not found for the collection');
select lives_ok($$select public.delete_verse('learning-alone', 'my-verses')$$,
  'another account naming the verse from its own collection changes nothing');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select is((select count(*)::int from public.verse_collections where collection_id = 'b0000000-0000-4000-8000-0000000000a2'), 3,
  'the other account changed nothing');

select throws_ok($$select public.delete_verse('learning-alone', 'no-such-collection')$$, '22023', null,
  'an unknown collection is not found');
select throws_ok($$select public.delete_verse('learning-alone', 'mastered')$$, '22023', null,
  'a virtual collection is not found');

select lives_ok($$select public.delete_verse('held-elsewhere', 'list')$$, 'a verse held elsewhere leaves the collection');
select is((select deleted_at from public.user_verses where client_id = 'held-elsewhere'), null::timestamptz,
  'and stays live, mastered or not');
select is((select array_agg(collection_id) from public.verse_collections where verse_id = 'b0000000-0000-4000-8000-0000000000b1'),
  array['b0000000-0000-4000-8000-0000000000a3'::uuid], 'and keeps only its other membership');

select lives_ok($$select public.delete_verse('mastered-alone', 'list')$$, 'a mastered verse held nowhere else leaves');
select isnt((select deleted_at from public.user_verses where client_id = 'mastered-alone'), null::timestamptz,
  'and is soft-deleted, kept for the Mastered list');
select is((select count(*)::int from public.verse_collections where verse_id = 'b0000000-0000-4000-8000-0000000000b2'), 0,
  'with no membership left');

select lives_ok($$select public.delete_verse('learning-alone', 'list')$$, 'an unmastered verse held nowhere else leaves');
select is((select count(*)::int from public.user_verses where client_id = 'learning-alone'), 0, 'and is deleted');

-- Retries after a lost response.
select lives_ok($$select public.delete_verse('held-elsewhere', 'list')$$, 'a retry for a verse held elsewhere is a no-op');
select lives_ok($$select public.delete_verse('mastered-alone', 'list')$$, 'a retry for a soft-deleted verse is a no-op');
select lives_ok($$select public.delete_verse('learning-alone', 'list')$$, 'a retry for a deleted verse is a no-op');
select is((select count(*)::int from public.user_verses where client_id in ('held-elsewhere', 'mastered-alone')
  and (client_id = 'mastered-alone') = (deleted_at is not null)), 2, 'the retries changed nothing');

-- A member's shared copy changes through the group's reference list.
select set_config('request.jwt.claim.sub', current_setting('test.reader_d'), true);
select throws_ok($$select public.delete_verse('seed-d-romans-8-28', 'shared-cccccccc-0000-4000-8000-000000000031')$$,
  '22023', null, 'a verse in a shared copy is refused');
select is((select count(*)::int from public.verse_collections where collection_id = 'dddddddd-0000-4000-8000-000000000012'
  and verse_id = 'dddddddd-0000-4000-8000-000000000022'), 1, 'the shared copy is untouched');

select * from finish();
rollback;
