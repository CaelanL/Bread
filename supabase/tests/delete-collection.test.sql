begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- reader-b starts empty. "Doomed" holds a mastered verse also in "Kept", plus a mastered and an
-- unmastered verse held nowhere else.
select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.reader_d', (select id::text from auth.users where email = 'reader-d@example.test'), true);

insert into public.user_collections (id, user_id, client_id, name, is_default, created_at)
values
  ('b0000000-0000-4000-8000-0000000000a1', current_setting('test.reader_b')::uuid, 'my-verses', 'My Verses', true, 'epoch'),
  ('b0000000-0000-4000-8000-0000000000a2', current_setting('test.reader_b')::uuid, 'doomed', 'Doomed', false, now()),
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

select ok(not has_function_privilege('anon', 'public.delete_collection(text)', 'EXECUTE'),
  'anonymous API calls cannot delete collections');
select is((select prosecdef from pg_proc where oid = 'public.delete_collection(text)'::regprocedure), false,
  'delete_collection runs with caller privileges');

set local role authenticated;

-- Another account can't reach reader-b's collection.
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select throws_ok($$select public.delete_collection('doomed')$$, '22023', null,
  'another account gets not found');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select is((select deleted_at from public.user_collections where client_id = 'doomed'), null::timestamptz,
  'the other account changed nothing');

select throws_ok($$select public.delete_collection('my-verses')$$, '22023', null, 'My Verses cannot be deleted');
select throws_ok($$select public.delete_collection('no-such-collection')$$, '22023', null,
  'an unknown collection is not found');

select lives_ok($$select public.delete_collection('doomed')$$, 'the owner deletes the collection');
select isnt((select deleted_at from public.user_collections where client_id = 'doomed'), null::timestamptz,
  'the collection is soft-deleted');
select is((select count(*)::int from public.verse_collections where collection_id = 'b0000000-0000-4000-8000-0000000000a2'), 0,
  'its memberships are gone');
select is((select deleted_at from public.user_verses where client_id = 'held-elsewhere'), null::timestamptz,
  'a mastered verse held in another collection stays live');
select is((select count(*)::int from public.verse_collections where verse_id = 'b0000000-0000-4000-8000-0000000000b1'), 1,
  'and keeps its other membership');
select isnt((select deleted_at from public.user_verses where client_id = 'mastered-alone'), null::timestamptz,
  'a mastered verse held nowhere else is soft-deleted, kept for the Mastered list');
select is((select count(*)::int from public.user_verses where client_id = 'learning-alone'), 0,
  'an unmastered verse held nowhere else is deleted');

select lives_ok($$select public.delete_collection('doomed')$$, 'a retry after success is a no-op');

-- A member's shared copy goes through leave, not delete.
select set_config('request.jwt.claim.sub', current_setting('test.reader_d'), true);
select throws_ok($$select public.delete_collection('shared-cccccccc-0000-4000-8000-000000000031')$$, '22023', null,
  'a shared copy must be left or unshared first');
select is((select deleted_at from public.user_collections where client_id = 'shared-cccccccc-0000-4000-8000-000000000031'),
  null::timestamptz, 'the shared copy is untouched');

select * from finish();
rollback;
