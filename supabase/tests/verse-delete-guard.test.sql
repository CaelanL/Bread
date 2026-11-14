-- A client's hard delete of a verse still in a collection nobody else holds is refused (old apps'
-- unsafe collection delete); every current delete path, collapseVerse's shape and cascades pass.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.reader_c', (select id::text from auth.users where email = 'reader-c@example.test'), true);

-- reader-b: "One" and "Two" share John 1:1; John 1:2 is only in One; John 1:3 is in nothing.
-- John 1:4 in ESV and NIV, both in One and Two (what collapseVerse leaves before it deletes the
-- loser). John 1:5 is only in "Three"; John 1:6 only in One.
insert into public.user_collections (id, user_id, client_id, name, is_default, created_at)
values
  ('b1000000-0000-4000-8000-0000000000c1', current_setting('test.reader_b')::uuid, 'one', 'One', false, now()),
  ('b1000000-0000-4000-8000-0000000000c2', current_setting('test.reader_b')::uuid, 'two', 'Two', false, now()),
  ('b1000000-0000-4000-8000-0000000000c3', current_setting('test.reader_b')::uuid, 'three', 'Three', false, now());

insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version)
values
  ('b1000000-0000-4000-8000-0000000000a1', current_setting('test.reader_b')::uuid, 'shared', 'John', 1, 1, 1, 'ESV'),
  ('b1000000-0000-4000-8000-0000000000a2', current_setting('test.reader_b')::uuid, 'alone', 'John', 1, 2, 2, 'ESV'),
  ('b1000000-0000-4000-8000-0000000000a3', current_setting('test.reader_b')::uuid, 'free', 'John', 1, 3, 3, 'ESV'),
  ('b1000000-0000-4000-8000-0000000000a4', current_setting('test.reader_b')::uuid, 'loser', 'John', 1, 4, 4, 'ESV'),
  ('b1000000-0000-4000-8000-0000000000a5', current_setting('test.reader_b')::uuid, 'winner', 'John', 1, 4, 4, 'NIV'),
  ('b1000000-0000-4000-8000-0000000000a6', current_setting('test.reader_b')::uuid, 'in-three', 'John', 1, 5, 5, 'ESV'),
  ('b1000000-0000-4000-8000-0000000000a7', current_setting('test.reader_b')::uuid, 'removable', 'John', 1, 6, 6, 'ESV');

insert into public.verse_collections (verse_id, collection_id)
values
  ('b1000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000c1'),
  ('b1000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000c2'),
  ('b1000000-0000-4000-8000-0000000000a2', 'b1000000-0000-4000-8000-0000000000c1'),
  ('b1000000-0000-4000-8000-0000000000a4', 'b1000000-0000-4000-8000-0000000000c1'),
  ('b1000000-0000-4000-8000-0000000000a4', 'b1000000-0000-4000-8000-0000000000c2'),
  ('b1000000-0000-4000-8000-0000000000a5', 'b1000000-0000-4000-8000-0000000000c1'),
  ('b1000000-0000-4000-8000-0000000000a5', 'b1000000-0000-4000-8000-0000000000c2'),
  ('b1000000-0000-4000-8000-0000000000a6', 'b1000000-0000-4000-8000-0000000000c3'),
  ('b1000000-0000-4000-8000-0000000000a7', 'b1000000-0000-4000-8000-0000000000c1');

select is((select prosecdef from pg_proc where oid = 'private.guard_verse_delete()'::regprocedure), false,
  'the guard runs with the caller''s privileges');
select ok(not has_function_privilege('authenticated', 'private.guard_verse_delete()', 'EXECUTE'),
  'clients cannot call the guard directly');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);

select throws_ok($$delete from public.user_verses where client_id = 'shared'$$, 'P0001', 'This verse is still in a collection',
  'a delete of a verse in two collections is refused');
select throws_ok($$delete from public.user_verses where client_id = 'alone'$$, 'P0001', 'This verse is still in a collection',
  'a delete of a verse still in one collection is refused');
select is((select count(*)::int from public.verse_collections where verse_id = 'b1000000-0000-4000-8000-0000000000a1'), 2,
  'the refused verse keeps its links');
select lives_ok($$delete from public.user_verses where client_id = 'free'$$, 'a verse in no collection deletes');

select lives_ok($$delete from public.user_verses where client_id = 'loser'$$,
  'collapse: a twin of the same reference holds every link, so the loser deletes');
select is((select count(*)::int from public.verse_collections where verse_id = 'b1000000-0000-4000-8000-0000000000a4'), 0,
  'the loser''s links cascade');
select is((select count(*)::int from public.verse_collections where verse_id = 'b1000000-0000-4000-8000-0000000000a5'), 2,
  'the winner keeps its links');

select lives_ok($$select public.delete_collection('three')$$, 'delete_collection still deletes its verses');
select is((select count(*)::int from public.user_verses where client_id = 'in-three'), 0, 'the collection''s verse is gone');
select lives_ok($$select public.delete_verse('removable', 'one')$$, 'delete_verse still deletes');
select is((select count(*)::int from public.user_verses where client_id = 'removable'), 0, 'the removed verse is gone');

-- The owner removes Romans 8:38-39 from the group: each member's copy loses it (a trigger's delete).
select set_config('request.jwt.claim.sub', current_setting('test.reader_c'), true);
select lives_ok($$delete from public.shared_collection_verses where book = 'Romans' and chapter = 8 and verse_start = 38$$,
  'a shared reference removal still deletes members'' copies');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select lives_ok($$select public.delete_own_account()$$, 'delete_own_account still deletes a user with linked verses');

reset role;
select lives_ok($$delete from public.user_verses where client_id = 'seed-c-romans-8-38-39'$$,
  'server-side roles are not guarded');
select is((select count(*)::int from public.user_verses where client_id = 'seed-d-romans-8-38-39'), 0,
  'the member''s copy of the removed reference is gone');
select lives_ok(format('delete from auth.users where id = %L', current_setting('test.reader_a')),
  'deleting a user with linked verses cascades past the guard');

select * from finish();
rollback;
