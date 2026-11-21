-- add_verse: one transaction that adds a verse to one of the caller's own collections. Uses a
-- fresh account made here, so drifted seed data can't change the result. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

select set_config('test.u', 'e0000000-0000-4000-8000-000000000001', true);
select set_config('test.a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
insert into auth.users (id, email) values (current_setting('test.u')::uuid, 'add-verse@example.test');

insert into public.user_collections (id, user_id, client_id, name, is_default, created_at, deleted_at)
values
  ('e0000000-0000-4000-8000-0000000000a1', current_setting('test.u')::uuid, 'kept', 'Kept', false, now(), null),
  ('e0000000-0000-4000-8000-0000000000a2', current_setting('test.u')::uuid, 'other', 'Other', false, now(), null),
  ('e0000000-0000-4000-8000-0000000000a3', current_setting('test.u')::uuid, 'gone', 'Gone', false, now(), now());
insert into public.shared_collections (id, owner_id, name)
values ('e0000000-0000-4000-8000-0000000000c1', current_setting('test.u')::uuid, 'Team');
insert into public.shared_collection_members (shared_collection_id, user_id, role)
values ('e0000000-0000-4000-8000-0000000000c1', current_setting('test.u')::uuid, 'owner');
insert into public.user_collections (id, user_id, client_id, name, is_default, created_at, shared_collection_id)
values ('e0000000-0000-4000-8000-0000000000a4', current_setting('test.u')::uuid, 'team', 'Team', false, now(),
  'e0000000-0000-4000-8000-0000000000c1');

-- Removed rows: John 1:1 mastered in NIV and learning in ESV; John 1:2 mastered in NIV alone;
-- John 1:3 learning and John 1:5 mastered, in NIV alone. John 1:4 is held in "Kept".
insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress, deleted_at, last_chunk_size)
values
  ('e0000000-0000-4000-8000-0000000000b1', current_setting('test.u')::uuid, 'john-1-1-niv', 'John', 1, 1, 1, 'NIV',
    '{"hard":{"bestAccuracy":95,"completed":true}}', now(), 2),
  ('e0000000-0000-4000-8000-0000000000b2', current_setting('test.u')::uuid, 'john-1-1-esv', 'John', 1, 1, 1, 'ESV',
    '{"easy":{"bestAccuracy":90,"completed":true}}', now(), null),
  ('e0000000-0000-4000-8000-0000000000b3', current_setting('test.u')::uuid, 'john-1-2-niv', 'John', 1, 2, 2, 'NIV',
    '{"hard":{"bestAccuracy":95,"completed":true}}', now(), null),
  ('e0000000-0000-4000-8000-0000000000b4', current_setting('test.u')::uuid, 'john-1-3-niv', 'John', 1, 3, 3, 'NIV',
    '{"easy":{"bestAccuracy":80,"completed":false}}', now(), null),
  ('e0000000-0000-4000-8000-0000000000b6', current_setting('test.u')::uuid, 'john-1-5-niv', 'John', 1, 5, 5, 'NIV',
    '{"hard":{"bestAccuracy":95,"completed":true}}', now(), null),
  ('e0000000-0000-4000-8000-0000000000b5', current_setting('test.u')::uuid, 'john-1-4', 'John', 1, 4, 4, 'NIV',
    '{"easy":{"bestAccuracy":80,"completed":true}}', null, null);
insert into public.verse_collections (verse_id, collection_id)
values ('e0000000-0000-4000-8000-0000000000b5', 'e0000000-0000-4000-8000-0000000000a1');

-- Fails the link on demand, after any restore in the same call.
create function pg_temp.fail_link() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail_link', true) = 'on' then
    raise exception 'injected failure';
  end if;
  return new;
end;
$$;
create trigger fail_link before insert on public.verse_collections
  for each row execute function pg_temp.fail_link();

select ok(not has_function_privilege('anon', 'public.add_verse(text,integer,integer,integer,text,text,boolean)', 'EXECUTE'),
  'anonymous API calls cannot add verses');
select ok(has_function_privilege('authenticated', 'public.add_verse(text,integer,integer,integer,text,text,boolean)', 'EXECUTE'),
  'signed-in callers can');
select is((select prosecdef from pg_proc where oid = 'public.add_verse(text,integer,integer,integer,text,text,boolean)'::regprocedure),
  false, 'add_verse runs with caller privileges');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.u'), true);

-- A new reference into My Verses, which doesn't exist yet.
select is((select client_id from public.add_verse('Romans', 8, 28, 28, 'ESV', 'my-verses')) like 'verse-%', true,
  'a new reference returns its new row');
select is((select is_default from public.user_collections where client_id = 'my-verses'), true,
  'My Verses is created on first use');
select is((select count(*)::int from public.verse_collections vc join public.user_verses v on v.id = vc.verse_id
  where v.book = 'Romans' and vc.collection_id = (select id from public.user_collections where client_id = 'my-verses')), 1,
  'and holds the verse');
select is((select version from public.user_verses where book = 'Romans'), 'ESV', 'in the given translation');
select lives_ok($$select public.add_verse('Romans', 8, 28, 28, 'ESV', 'my-verses')$$, 'adding it again succeeds');
select is((select count(*)::int from public.user_verses where book = 'Romans'), 1, 'with no second row');
select is((select count(*)::int from public.verse_collections vc join public.user_verses v on v.id = vc.verse_id
  where v.book = 'Romans'), 1, 'and no second link');

-- Collections it refuses, changing nothing.
select throws_ok($$select public.add_verse('Romans', 8, 29, 29, 'ESV', 'no-such')$$, '22023', 'Collection not found',
  'an unknown collection is an error, not My Verses');
select throws_ok($$select public.add_verse('Romans', 8, 29, 29, 'ESV', 'gone')$$, '22023', 'Collection not found',
  'so is a deleted one');
select throws_ok($$select public.add_verse('Romans', 8, 29, 29, 'ESV', 'mastered')$$, '22023', 'Collection not found',
  'and a virtual one');
select throws_ok($$select public.add_verse('Romans', 8, 29, 29, 'ESV', 'team')$$, '22023',
  'Add verses to a shared collection through the group', 'a shared copy adds through the group');
select is((select count(*)::int from public.user_verses where book = 'Romans' and verse_start = 29), 0,
  'none of those made a verse');
select throws_ok($$select public.add_verse('Romans', 8, 30, 29, 'ESV', 'kept')$$, '22023', 'Invalid verse',
  'a backwards range is refused');

-- A held verse is reused in its own translation.
select is((select id from public.add_verse('John', 1, 4, 4, 'ESV', 'other')), 'e0000000-0000-4000-8000-0000000000b5'::uuid,
  'a held verse is reused');
select is((select version from public.user_verses where client_id = 'john-1-4'), 'NIV', 'its translation unchanged');
select is((select count(*)::int from public.verse_collections where verse_id = 'e0000000-0000-4000-8000-0000000000b5'), 2,
  'it is now in both collections');

-- Removed rows come back.
select is((select id from public.add_verse('John', 1, 1, 1, 'ESV', 'kept')), 'e0000000-0000-4000-8000-0000000000b1'::uuid,
  'the best removed row comes back: mastered beats the row already in the translation');
select is((select version from public.user_verses where client_id = 'john-1-1-niv'), 'NIV',
  'it keeps its translation while another row holds the account one');
select is((select last_chunk_size from public.user_verses where client_id = 'john-1-1-niv'), 2,
  'and its study preferences');
select is((select deleted_at from public.user_verses where client_id = 'john-1-1-esv'), now(), 'the other row stays removed');

select is((select version from public.add_verse('John', 1, 2, 2, 'ESV', 'kept')), 'ESV',
  'a removed row alone comes back in the account translation');
select is((select (progress #>> '{hard,completed}') from public.user_verses where client_id = 'john-1-2-niv'), 'true',
  'with its progress');

select is((select version from public.add_verse('John', 1, 3, 3, 'ESV', 'kept', true)), 'NIV',
  'unless the client says that translation may leave the verse out');

-- All or nothing.
select set_config('test.fail_link', 'on', true);
select throws_ok($$select public.add_verse('John', 1, 5, 5, 'ESV', 'other')$$, 'P0001', 'injected failure',
  'a failed link fails the call');
select set_config('test.fail_link', 'off', true);
select isnt((select deleted_at from public.user_verses where client_id = 'john-1-5-niv'), null::timestamptz,
  'and the restore before it is undone, so the verse never sits in no collection');

-- Another account's collections are out of reach.
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok($$select public.add_verse('Romans', 8, 31, 31, 'ESV', 'kept')$$, '22023', 'Collection not found',
  'another account can''t add to this collection');
reset role;
select is((select count(*)::int from public.user_verses where user_id = current_setting('test.a')::uuid
  and book = 'Romans' and verse_start = 31), 0, 'and made no verse of its own');

select is((select count(*)::int from public.user_verses where user_id = current_setting('test.u')::uuid and deleted_at is null), 5,
  'the account ends with Romans 8:28 and John 1:1 to 1:4 live');
select is((select count(*)::int from public.verse_collections vc join public.user_collections c on c.id = vc.collection_id
  where c.user_id = current_setting('test.u')::uuid), 6, 'in six links');

select * from finish();
rollback;
