begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);

insert into public.user_collections (user_id, client_id, name, deleted_at)
values
  (current_setting('test.reader_a')::uuid, 'library-second', 'Second', null),
  (current_setting('test.reader_a')::uuid, 'library-deleted', 'Deleted', now()),
  (current_setting('test.reader_b')::uuid, 'library-other', 'Other reader', null);

insert into public.user_verses (
  user_id, client_id, book, chapter, verse_start, verse_end, version,
  progress, last_practiced_at, last_chunk_size, last_difficulty, deleted_at
)
select user_id, 'library-soft-deleted', 'John', 3, 17, 17, version,
  progress, last_practiced_at, 2, 'hard', now()
from public.user_verses
where client_id = 'seed-john-3-16' and user_id = current_setting('test.reader_a')::uuid;

insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version)
values (current_setting('test.reader_b')::uuid, 'library-other-verse', 'John', 3, 16, 16, 'ESV');

select set_config('test.soft_deleted_verse', (
  select (to_jsonb(v) - 'deleted_at' - 'updated_at')::text
  from public.user_verses as v where v.client_id = 'library-soft-deleted'
), true);

select ok(not has_function_privilege('anon', 'public.reorder_collections(text[])', 'EXECUTE'),
  'anonymous API calls cannot reorder collections');
select ok(not has_function_privilege('anon', 'public.copy_verse_to_collection(text,text)', 'EXECUTE'),
  'anonymous API calls cannot copy verses');
select is((
  select count(*)::int from pg_proc
  where oid in ('public.reorder_collections(text[])'::regprocedure,
                'public.copy_verse_to_collection(text,text)'::regprocedure)
    and prosecdef
), 0, 'both RPCs run with caller privileges');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);

select lives_ok($$select public.reorder_collections(array['library-second', 'seed-psalms'])$$,
  'owner can save the full custom order');
select is((
  select array_agg(client_id order by position, created_at, client_id)
  from public.user_collections where deleted_at is null and not is_default
), array['library-second', 'seed-psalms'], 'both positions persist in the requested order');
select is((select position from public.user_collections where client_id = 'my-verses'), null::integer,
  'built-in collection position is untouched');

select throws_ok($$select public.reorder_collections(array['seed-psalms', 'seed-psalms'])$$,
  '22023', null, 'duplicate IDs are rejected');
select throws_ok($$select public.reorder_collections(array['seed-psalms'])$$,
  '22023', null, 'incomplete order is rejected');
select throws_ok($$select public.reorder_collections(array['seed-psalms', 'my-verses'])$$,
  '22023', null, 'a pinned ID cannot take a custom position');
select throws_ok($$select public.reorder_collections(array['seed-psalms', 'library-deleted'])$$,
  '22023', null, 'deleted collection cannot be reordered');
select throws_ok($$select public.reorder_collections(array['seed-psalms', 'library-other'])$$,
  '22023', null, 'other owners cannot be reordered');
select is((
  select position from public.user_collections where client_id = 'seed-psalms'
), 2, 'invalid saves leave the previous order intact');

insert into public.user_collections (user_id, client_id, name)
values (current_setting('test.reader_a')::uuid, 'library-new', 'New');
select is((
  select array_agg(client_id order by position nulls last, created_at, client_id)
  from public.user_collections where deleted_at is null and not is_default
), array['library-second', 'seed-psalms', 'library-new'], 'an old-client insert sorts after saved positions');
update public.user_collections set name = 'Renamed' where client_id = 'seed-psalms';
select is((
  select position from public.user_collections where client_id = 'seed-psalms'
), 2, 'renaming leaves the saved position unchanged');
select is((
  select count(*)::int from public.verse_collections as vc
  join public.user_collections as c on c.id = vc.collection_id where c.client_id = 'seed-psalms'
), 1, 'renaming leaves its memberships intact');

select is((
  select verse_id from public.copy_verse_to_collection('seed-john-3-16', 'library-second')
), (select id from public.user_verses where client_id = 'seed-john-3-16'),
  'copy points to the same verse row');
select is((
  select verse_id from public.copy_verse_to_collection('seed-john-3-16', 'library-second')
), (select id from public.user_verses where client_id = 'seed-john-3-16'),
  'repeating copy returns the existing membership');
select is((
  select count(*)::int from public.verse_collections as vc
  join public.user_verses as v on v.id = vc.verse_id where v.client_id = 'seed-john-3-16'
), 2, 'the original and copied memberships both exist once');

select throws_ok($$select public.copy_verse_to_collection('library-other-verse', 'library-second')$$,
  '22023', null, 'copy rejects another owner’s verse');
select throws_ok($$select public.copy_verse_to_collection('library-soft-deleted', 'library-other')$$,
  '22023', null, 'copy rejects another owner’s collection');
select throws_ok($$select public.copy_verse_to_collection('library-soft-deleted', 'library-missing')$$,
  '22023', null, 'copy rejects a missing custom destination');
select throws_ok($$select public.copy_verse_to_collection('library-soft-deleted', 'library-deleted')$$,
  '22023', null, 'copy rejects a deleted destination');
select throws_ok($$select public.copy_verse_to_collection('library-soft-deleted', 'mastered')$$,
  '22023', null, 'copy rejects a virtual destination');
select ok((
  select deleted_at is not null from public.user_verses where client_id = 'library-soft-deleted'
), 'failed copy leaves the source soft-deleted');
select is((
  select verse_id from public.copy_verse_to_collection('library-soft-deleted', 'library-second')
), (select id from public.user_verses where client_id = 'library-soft-deleted'),
  'copy restores the original soft-deleted verse');
select ok((
  select deleted_at is null and (to_jsonb(v) - 'deleted_at' - 'updated_at') = current_setting('test.soft_deleted_verse')::jsonb
  from public.user_verses as v where v.client_id = 'library-soft-deleted'
), 'restored verse retains identity, version, progress, and study preferences');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select lives_ok($$select public.copy_verse_to_collection('library-other-verse', 'my-verses')$$,
  'copy can create the default collection when explicitly chosen');
select is((
  select count(*)::int from public.verse_collections as vc
  join public.user_collections as c on c.id = vc.collection_id where c.client_id = 'my-verses' and c.is_default
), 1, 'the new default collection holds the copied verse');
select is((select position from public.user_collections where client_id = 'library-other'), null::integer,
  'other owner’s order remains unchanged');

select * from finish();
rollback;
