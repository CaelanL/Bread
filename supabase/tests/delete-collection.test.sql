begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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

-- reader-b also owns the shared "Team" (a mastered and an unmastered reference), and reader-a is
-- a member whose copy is still empty. test.fail_team_delete makes the last step fail on demand.
insert into public.shared_collections (id, owner_id, name, created_at)
values ('b0000000-0000-4000-8000-0000000000c1', current_setting('test.reader_b')::uuid, 'Team', now());
insert into public.shared_collection_members (shared_collection_id, user_id, role)
values
  ('b0000000-0000-4000-8000-0000000000c1', current_setting('test.reader_b')::uuid, 'owner'),
  ('b0000000-0000-4000-8000-0000000000c1', current_setting('test.reader_a')::uuid, 'member');
insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end)
values
  ('b0000000-0000-4000-8000-0000000000c1', 'John', 1, 4, 4),
  ('b0000000-0000-4000-8000-0000000000c1', 'John', 1, 5, 5);
insert into public.user_collections (id, user_id, client_id, name, is_default, created_at, shared_collection_id)
values
  ('b0000000-0000-4000-8000-0000000000a4', current_setting('test.reader_b')::uuid, 'team', 'Team', false, now(),
    'b0000000-0000-4000-8000-0000000000c1'),
  ('b0000000-0000-4000-8000-0000000000a5', current_setting('test.reader_a')::uuid, 'shared-b0000000-0000-4000-8000-0000000000c1',
    'Team', false, now(), 'b0000000-0000-4000-8000-0000000000c1');
insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress)
values
  ('b0000000-0000-4000-8000-0000000000b4', current_setting('test.reader_b')::uuid, 'team-mastered', 'John', 1, 4, 4, 'ESV',
    '{"hard":{"bestAccuracy":95,"completed":true}}'),
  ('b0000000-0000-4000-8000-0000000000b5', current_setting('test.reader_b')::uuid, 'team-learning', 'John', 1, 5, 5, 'ESV',
    '{"hard":{"bestAccuracy":40,"completed":false}}');
insert into public.verse_collections (verse_id, collection_id)
values
  ('b0000000-0000-4000-8000-0000000000b4', 'b0000000-0000-4000-8000-0000000000a4'),
  ('b0000000-0000-4000-8000-0000000000b5', 'b0000000-0000-4000-8000-0000000000a4');

create function pg_temp.fail_team_delete() returns trigger language plpgsql as $$
begin
  if current_setting('test.fail_team_delete', true) = 'on' and new.client_id = 'team' and new.deleted_at is not null then
    raise exception 'injected failure';
  end if;
  return new;
end;
$$;
create trigger fail_team_delete before update on public.user_collections
  for each row execute function pg_temp.fail_team_delete();

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

-- The owner's "Delete for everyone": the group dissolves and the owner's copy goes, in one call.
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select throws_ok($$select public.delete_collection('shared-b0000000-0000-4000-8000-0000000000c1')$$, '22023',
  'Stop sharing or leave this collection first', 'a member still leaves instead of deleting');
select is((select count(*)::int from public.shared_collection_members where shared_collection_id = 'b0000000-0000-4000-8000-0000000000c1'), 2,
  'the member delete changed nothing');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select set_config('test.fail_team_delete', 'on', true);
select throws_ok($$select public.delete_collection('team')$$, 'P0001', 'injected failure',
  'a failure after the group is deleted fails the call');
select set_config('test.fail_team_delete', 'off', true);
select is((select count(*)::int from public.shared_collections where id = 'b0000000-0000-4000-8000-0000000000c1'), 1,
  'and the group is still there');
select is((select shared_collection_id from public.user_collections where client_id = 'team'),
  'b0000000-0000-4000-8000-0000000000c1'::uuid, 'the owner''s copy is still shared');
select is((select count(*)::int from public.verse_collections where collection_id = 'b0000000-0000-4000-8000-0000000000a4'), 2,
  'and still holds both verses');

select lives_ok($$select public.delete_collection('team')$$, 'the owner deletes a shared collection for everyone');
select is((select count(*)::int from public.shared_collections where id = 'b0000000-0000-4000-8000-0000000000c1'), 0,
  'the group is gone');
select isnt((select deleted_at from public.user_collections where client_id = 'team'), null::timestamptz,
  'the owner''s copy is deleted');
select isnt((select deleted_at from public.user_verses where client_id = 'team-mastered'), null::timestamptz,
  'the owner''s mastered verse is soft-deleted, kept for the Mastered list');
select is((select count(*)::int from public.user_verses where client_id = 'team-learning'), 0,
  'the owner''s unmastered verse is deleted');
select lives_ok($$select public.delete_collection('team')$$, 'a retry after success is a no-op');

reset role;
select is((select shared_collection_id from public.user_collections where id = 'b0000000-0000-4000-8000-0000000000a5'), null::uuid,
  'the member''s copy is personal now');
select is((select count(*)::int from public.verse_collections where collection_id = 'b0000000-0000-4000-8000-0000000000a5'), 2,
  'and holds every reference the group had');

select * from finish();
rollback;
