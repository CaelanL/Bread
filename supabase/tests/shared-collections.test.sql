-- Shared collections: who can read what, join, caps, leave, remove and dissolve.
-- Uses the seed logins: reader-c owns "Romans 8", reader-d is a member, reader-a and reader-b
-- are not. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('test.a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.c', (select id::text from auth.users where email = 'reader-c@example.test'), true);
select set_config('test.d', (select id::text from auth.users where email = 'reader-d@example.test'), true);
select set_config('test.s', (select id::text from public.shared_collections where name = 'Romans 8'), true);

-- ---------- Surface

select ok(not has_table_privilege('anon', t, 'SELECT,INSERT,UPDATE,DELETE'), t || ': no anonymous access')
from unnest(array['public.shared_collections', 'public.shared_collection_members',
  'public.shared_collection_verses', 'public.shared_invites']) as t;
select ok(not has_function_privilege('anon', f, 'EXECUTE'), f || ': not callable anonymously')
from unnest(array['public.share_collection(text)', 'public.mint_invite(uuid)', 'public.preview_invite(text)',
  'public.join_shared_collection(text,text)', 'public.sync_shared_collection(uuid,text)',
  'public.leave_shared_collection(uuid)', 'public.remove_shared_member(uuid,uuid)',
  'public.get_shared_members(uuid)', 'public.get_shared_progress(uuid)', 'public.get_shared_status()']) as f;
select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname in ('share_collection', 'mint_invite', 'preview_invite',
      'join_shared_collection', 'sync_shared_collection', 'leave_shared_collection', 'remove_shared_member',
      'get_shared_members', 'get_shared_progress', 'get_shared_status')),
  array[]::text[], 'every public shared-collection function is invoker');
select is(
  array(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)),
  array[]::text[], 'every private definer pins an empty search path');
select ok(not has_function_privilege('authenticated', f, 'EXECUTE'), f || ': not callable by clients')
from unnest(array['private.member_squares(uuid)', 'private.sync_member_copies(uuid,uuid,text)',
  'private.drop_member_collection(uuid,uuid)', 'private.remove_verse_from_collection(uuid,uuid,uuid)',
  'private.new_invite_code()', 'private.shared_limits()']) as f;
select ok(not has_table_privilege('authenticated', 'public.shared_invites', 'INSERT')
  and not has_table_privilege('authenticated', 'public.shared_invites', 'UPDATE')
  and not has_any_column_privilege('authenticated', 'public.shared_invites', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.shared_invites', 'UPDATE'),
  'clients only read invites');
select ok(not has_column_privilege('authenticated', 'public.user_collections', 'shared_collection_id', 'INSERT')
  and not has_column_privilege('authenticated', 'public.user_collections', 'shared_collection_id', 'UPDATE'),
  'clients cannot link a collection to a group');

-- ---------- Access: a non-member sees nothing

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select is((select count(*)::int from public.shared_collections), 0, 'non-member reads no groups');
select is((select count(*)::int from public.shared_collection_verses), 0, 'non-member reads no group verses');
select is((select count(*)::int from public.shared_collection_members), 0, 'non-member reads no members');
select is((select count(*)::int from public.shared_invites), 0, 'non-member reads no invites');
select throws_ok(format('select * from public.get_shared_members(%L)', current_setting('test.s')), '42501', null,
  'non-member cannot list members');
select throws_ok(format('select * from public.get_shared_progress(%L)', current_setting('test.s')), '42501', null,
  'non-member cannot read members'' progress');
select is((select count(*)::int from public.get_shared_status()), 0, 'non-member gets no status rows');
select throws_ok(format('select public.sync_shared_collection(%L, ''ESV'')', current_setting('test.s')), '42501', null,
  'non-member cannot sync');
select throws_ok(format('select * from public.mint_invite(%L)', current_setting('test.s')), '42501', null,
  'non-member cannot mint an invite');
select throws_ok(format('select public.remove_shared_member(%L, %L)', current_setting('test.s'), current_setting('test.d')),
  '42501', null, 'non-member cannot remove a member');
select throws_ok(format('insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end) values (%L, ''John'', 1, 1, 1)',
  current_setting('test.s')), '42501', null, 'non-member cannot add a verse');
select throws_ok(format('insert into public.shared_collection_members (shared_collection_id, user_id, role) values (%L, %L, ''member'')',
  current_setting('test.s'), current_setting('test.a')), '42501', null, 'nobody inserts a membership directly');
select throws_ok(format('insert into public.shared_collections (owner_id, name) values (%L, ''Mine'')', current_setting('test.a')),
  '42501', null, 'nobody creates a group directly, so the caps hold');
delete from public.shared_collections;
update public.shared_collections set name = 'taken';

-- ---------- Access: a member sees the group and members' state on its verses only

select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
select is((select count(*)::int from public.shared_collections), 1, 'member reads the group');
select is((select count(*)::int from public.shared_collection_verses), 3, 'member reads the group''s verses');
select is((select count(*)::int from public.shared_collection_members), 2, 'member reads both members');
select is((select count(*)::int from public.shared_invites), 0, 'only the owner reads invites');
select is((select count(*)::int from public.user_verses where user_id = current_setting('test.c')::uuid), 0,
  'member reads none of the owner''s verses');
select is((select count(*)::int from public.user_collections where user_id = current_setting('test.c')::uuid), 0,
  'member reads none of the owner''s collections');
select results_eq(
  format('select display_name, role from public.get_shared_members(%L)', current_setting('test.s')),
  $$values ('Cara'::text, 'owner'::text), ('Dana', 'member')$$, 'member lists names and roles, owner first');
select results_eq(
  format('select user_id::text, verse_start, practiced, mastered, engraved from public.get_shared_progress(%L) order by 1, 2',
    current_setting('test.s')),
  format($$values (%L, 1, true, true, true), (%L, 28, true, true, false), (%L, 38, false, false, false),
    (%L, 1, true, true, true), (%L, 28, true, false, false), (%L, 38, false, false, false)$$,
    current_setting('test.c'), current_setting('test.c'), current_setting('test.c'),
    current_setting('test.d'), current_setting('test.d'), current_setting('test.d')),
  'member reads one boolean square per member and reference');
select results_eq('select member_count, verse_count, mastered_squares, engraved_squares from public.get_shared_status()',
  $$values (2, 3, 3, 2)$$, 'status counts squares for the Library card');
select throws_ok(format('insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end) values (%L, ''Romans'', 8, 31, 31)',
  current_setting('test.s')), '42501', null, 'a plain member cannot add verses');
select throws_ok(format('select * from public.mint_invite(%L)', current_setting('test.s')), '42501', null,
  'a member cannot mint an invite');
update public.shared_collection_members set role = 'editor';
select throws_ok(format('delete from public.shared_collection_members where user_id = %L', current_setting('test.d')),
  '42501', null, 'a member cannot drop their membership row directly (leave takes the copy too)');
delete from public.shared_collections;
reset role;
select results_eq(format('select role from public.shared_collection_members where shared_collection_id = %L order by joined_at',
  current_setting('test.s')), $$values ('owner'::text), ('member')$$, 'non-owners changed no roles and removed nobody');
select is((select name from public.shared_collections where id = current_setting('test.s')::uuid), 'Romans 8',
  'nobody but the owner renames or deletes the group');

-- ---------- Owner: roles, editors and sync

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select is((select count(*)::int from public.shared_invites where shared_collection_id = current_setting('test.s')::uuid), 1,
  'the owner reads their invite');
select throws_ok(format('insert into public.shared_invites (shared_collection_id) values (%L)', current_setting('test.s')),
  '42501', null, 'the owner cannot insert an extra invite');
select throws_ok($$update public.shared_invites set revoked_at = null$$, '42501', null,
  'the owner cannot revive or change an invite');
select throws_ok(format('insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end) values (%L, ''Foo'', 1, 1, 1)',
  current_setting('test.s')), '23514', null, 'a reference needs a canonical book name');
select throws_ok(format('update public.shared_collection_members set user_id = %L', current_setting('test.a')),
  '42501', null, 'the owner cannot move a membership to another account');
update public.shared_collection_members set role = 'member' where user_id = current_setting('test.c')::uuid
  and shared_collection_id = current_setting('test.s')::uuid;
select is((select role from public.shared_collection_members where user_id = current_setting('test.c')::uuid
  and shared_collection_id = current_setting('test.s')::uuid), 'owner',
  'the owner row keeps its role');
update public.shared_collection_members set role = 'editor' where user_id = current_setting('test.d')::uuid;

select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
select results_eq(format('select client_id, changed from public.sync_shared_collection(%L, ''NIV'')', current_setting('test.s')),
  format('values (%L, false)', 'shared-' || current_setting('test.s')), 'a member already in step syncs with changed = false');
select lives_ok(format('insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end) values (%L, ''Romans'', 8, 31, 31)',
  current_setting('test.s')), 'an editor adds a verse');
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select results_eq(format('select client_id, changed from public.sync_shared_collection(%L, ''ESV'')', current_setting('test.s')),
  $$values ('seed-romans-8'::text, true)$$, 'the owner''s sync returns their own collection id and changed = true after an add');
select results_eq(format('select changed from public.sync_shared_collection(%L, ''ESV'')', current_setting('test.s')),
  $$values (false)$$, 'a second sync changes nothing');
select is((select count(*)::int from public.verse_collections vc join public.user_verses v on v.id = vc.verse_id
  where vc.collection_id = 'cccccccc-0000-4000-8000-000000000012' and v.verse_start = 31 and v.version = 'ESV'), 1,
  'sync adds the new verse to the owner''s copy in their translation');
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
delete from public.shared_collection_verses where verse_start = 31;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select is((select count(*)::int from public.user_verses where verse_start = 31), 0,
  'an editor''s removal reaches every copy at once with today''s rule (unmastered: gone)');
select results_eq(format('select changed from public.sync_shared_collection(%L, ''ESV'')', current_setting('test.s')),
  $$values (false)$$, 'nothing is left for the next sync');

-- A removed reference the member also holds in another collection survives there.
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end)
values (current_setting('test.s')::uuid, 'Romans', 8, 34, 34);
select changed from public.sync_shared_collection(current_setting('test.s')::uuid, 'NIV');
insert into public.user_collections (id, user_id, client_id, name)
values ('dddddddd-0000-4000-8000-000000000098', current_setting('test.d')::uuid, 'keep', 'Keep');
insert into public.verse_collections (verse_id, collection_id)
select id, 'dddddddd-0000-4000-8000-000000000098' from public.user_verses
where user_id = current_setting('test.d')::uuid and verse_start = 34;
delete from public.shared_collection_verses where verse_start = 34;
select results_eq($$select c.client_id, v.deleted_at is null from public.verse_collections vc
  join public.user_collections c on c.id = vc.collection_id join public.user_verses v on v.id = vc.verse_id
  where v.user_id = current_setting('test.d')::uuid and v.verse_start = 34$$,
  $$values ('keep'::text, true)$$, 'a removed reference the member also holds in another collection survives there');
reset role;
delete from public.user_verses where user_id = current_setting('test.d')::uuid and verse_start = 34;
delete from public.user_collections where id = 'dddddddd-0000-4000-8000-000000000098';
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
update public.shared_collection_members set role = 'member' where user_id = current_setting('test.d')::uuid;

-- An old client put a verse of the member's own into the copy: sync moves it to My Verses.
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress)
values ('dddddddd-0000-4000-8000-000000000099', current_setting('test.d')::uuid, 'old-client-john', 'John', 3, 16, 16, 'NIV',
  '{"easy":{"bestAccuracy":80,"completed":false},"medium":{"bestAccuracy":null,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}');
insert into public.verse_collections (verse_id, collection_id)
values ('dddddddd-0000-4000-8000-000000000099', 'dddddddd-0000-4000-8000-000000000012');
select results_eq(format('select changed from public.sync_shared_collection(%L, ''NIV'')', current_setting('test.s')),
  $$values (true)$$, 'sync reports moving a verse');
select results_eq($$select c.client_id, v.deleted_at is null, v.progress -> 'easy' -> 'bestAccuracy'
  from public.verse_collections vc join public.user_collections c on c.id = vc.collection_id
  join public.user_verses v on v.id = vc.verse_id where v.id = 'dddddddd-0000-4000-8000-000000000099'$$,
  $$values ('my-verses'::text, true, '80'::jsonb)$$, 'a verse that is not a group reference survives sync in My Verses with its progress');

-- Caps on references: 200 per group.
reset role;
insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end)
select current_setting('test.s')::uuid, 'Psalms', ch, 1, 1 from generate_series(1, 150) as ch
union all select current_setting('test.s')::uuid, 'Psalms', 1, vs, vs from generate_series(2, 48) as vs;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select throws_ok(format('insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end) values (%L, ''Romans'', 8, 31, 31)',
  current_setting('test.s')), '22023', 'A shared collection holds up to 200 verses', 'the 201st reference is refused');
reset role;
delete from public.shared_collection_verses where book = 'Psalms';

-- ---------- Delete rule twin (private.remove_verse_from_collection), on reader-a's seed data

insert into public.verse_collections (verse_id, collection_id)
values ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000012');
select private.remove_verse_from_collection(current_setting('test.a')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000012');
select results_eq($$select deleted_at is null, (select count(*)::int from public.verse_collections where verse_id = v.id)
  from public.user_verses v where v.id = 'aaaaaaaa-0000-4000-8000-000000000021'$$,
  $$values (true, 1)$$, 'a verse in another collection loses only the link');
select private.remove_verse_from_collection(current_setting('test.a')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000011');
select ok((select deleted_at is not null from public.user_verses where id = 'aaaaaaaa-0000-4000-8000-000000000021'),
  'a mastered verse in no other collection is soft-deleted');
select private.remove_verse_from_collection(current_setting('test.a')::uuid,
  'aaaaaaaa-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000012');
select is((select count(*)::int from public.user_verses where id = 'aaaaaaaa-0000-4000-8000-000000000023'), 0,
  'an unmastered verse in no other collection is hard-deleted');

-- A client can't link its own collection to a group.
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok(format('update public.user_collections set shared_collection_id = %L where client_id = ''seed-psalms''', current_setting('test.s')),
  '42501', null, 'a client cannot point its collection at a group');
select throws_ok(format('insert into public.user_collections (user_id, client_id, name, shared_collection_id) values (%L, ''x'', ''X'', %L)',
  current_setting('test.a'), current_setting('test.s')), '42501', null, 'a client cannot create a collection linked to a group');
select lives_ok($$update public.user_collections set name = 'Psalms' where client_id = 'seed-psalms'$$,
  'other collection columns stay writable');

-- ---------- Join

select throws_ok($$select public.join_shared_collection('BREAD828', 'KJV')$$, '22023', 'Add your name first',
  'joining needs a display name');
insert into public.profiles (user_id, display_name) values (current_setting('test.a')::uuid, 'Abe');
select results_eq($$select name, inviter_name, verse_count, member_count, already_member from public.preview_invite(' bread-828 ')$$,
  $$values ('Romans 8'::text, 'Cara'::text, 3, 2, false)$$, 'a non-member previews a typed, unnormalized code');
select is(public.join_shared_collection('BREAD828', 'KJV'), 'shared-' || current_setting('test.s'),
  'join returns the member''s collection id');
select is(public.join_shared_collection('bread 828', 'KJV'), 'shared-' || current_setting('test.s'),
  'joining again returns the same collection');
select is((select count(*)::int from public.shared_collection_members where user_id = current_setting('test.a')::uuid), 1,
  'joining twice makes one membership');
select is((select count(*)::int from public.user_collections where shared_collection_id = current_setting('test.s')::uuid), 1,
  'joining twice makes one local collection');
select results_eq($$select v.verse_start, v.version, v.client_id = 'seed-romans-8-28' from public.verse_collections vc
  join public.user_verses v on v.id = vc.verse_id
  join public.user_collections c on c.id = vc.collection_id
  where c.shared_collection_id = current_setting('test.s')::uuid order by 1$$,
  $$values (1, 'KJV'::text, false), (28, 'ESV', true), (38, 'KJV', false)$$,
  'one copy per reference: the held Romans 8:28 is reused, the rest are new in the member''s translation');
select is((select count(*)::int from public.user_verses where verse_start = 28 and chapter = 8), 1,
  'no second Romans 8:28 row');
select is((select already_member from public.preview_invite('BREAD828')), true, 'preview knows a member');
select is((select count(*)::int from public.user_verses where user_id = current_setting('test.c')::uuid), 0,
  'a new member still reads none of the owner''s verses');

reset role;
insert into public.shared_invites (shared_collection_id, code, expires_at, revoked_at)
values (current_setting('test.s')::uuid, 'EXPRD234', now() - interval '1 minute', null),
  (current_setting('test.s')::uuid, 'RVKD2345', now() + interval '1 day', now());
insert into public.profiles (user_id, display_name) values (current_setting('test.b')::uuid, 'Bea');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select throws_ok($$select public.join_shared_collection('EXPRD234', 'ESV')$$, '22023', 'Invite expired', 'an expired code fails');
select throws_ok($$select * from public.preview_invite('EXPRD234')$$, '22023', 'Invite expired', 'an expired code does not preview');
select throws_ok($$select public.join_shared_collection('RVKD2345', 'ESV')$$, '22023', 'Invite not found', 'a revoked code fails');
select throws_ok($$select public.join_shared_collection('ZZZZZZZZ', 'ESV')$$, '22023', 'Invite not found', 'an unknown code fails');
select throws_ok($$select public.join_shared_collection('BREAD828', 'nope')$$, '22023', 'Invalid translation',
  'a bad translation fails before anything is written');
select is((select count(*)::int from public.shared_collection_members where user_id = current_setting('test.b')::uuid), 0,
  'failed joins leave no membership');

-- ---------- Caps

reset role;
insert into auth.users (id, email)
select ('eeeeeeee-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'cap-' || i || '@example.test'
from generate_series(1, 27) as i;
insert into public.shared_collection_members (shared_collection_id, user_id, role)
select current_setting('test.s')::uuid, ('eeeeeeee-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'member'
from generate_series(1, 27) as i;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select throws_ok($$select public.join_shared_collection('BREAD828', 'ESV')$$, '22023', 'This shared collection is full (30 members)',
  'the 31st member cannot join');
reset role;
delete from public.shared_collection_members where user_id::text like 'eeeeeeee-%';

insert into public.shared_collections (id, owner_id, name)
select ('ffffffff-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, ('eeeeeeee-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Cap ' || i
from generate_series(1, 20) as i;
insert into public.shared_collection_members (shared_collection_id, user_id, role)
select ('ffffffff-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, current_setting('test.b')::uuid, 'member'
from generate_series(1, 20) as i;
insert into public.user_collections (user_id, client_id, name)
values (current_setting('test.b')::uuid, 'b-mine', 'Mine');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select throws_ok($$select public.join_shared_collection('BREAD828', 'ESV')$$, '22023', 'You can be in up to 20 shared collections',
  'a 21st shared collection cannot be joined');
select throws_ok($$select * from public.share_collection('b-mine')$$, '22023', 'You can be in up to 20 shared collections',
  'a 21st shared collection cannot be shared');
reset role;
delete from public.shared_collections where id::text like 'ffffffff-%';

-- ---------- Share refusals

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select throws_ok($$select * from public.share_collection('seed-romans-8')$$, '22023', 'This collection is already shared',
  'a shared collection cannot be shared again');
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select throws_ok($$select * from public.share_collection('my-verses')$$, '22023', 'This collection can''t be shared',
  'My Verses cannot be shared');

-- ---------- Cross-group: a member of Romans 8 reaches nothing of another group

reset role;
insert into public.shared_collections (id, owner_id, name)
values ('bbbbbbbb-0000-4000-8000-000000000031', current_setting('test.b')::uuid, 'Other');
insert into public.shared_collection_members (shared_collection_id, user_id, role)
values ('bbbbbbbb-0000-4000-8000-000000000031', current_setting('test.b')::uuid, 'owner');
insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end)
values ('bbbbbbbb-0000-4000-8000-000000000031', 'John', 3, 16, 16);
insert into public.shared_invites (shared_collection_id, code) values ('bbbbbbbb-0000-4000-8000-000000000031', 'BGRP2345');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
select set_config('test.other', 'bbbbbbbb-0000-4000-8000-000000000031', true);
select is((select count(*)::int from public.shared_collections where id = current_setting('test.other')::uuid)
  + (select count(*)::int from public.shared_collection_verses where shared_collection_id = current_setting('test.other')::uuid)
  + (select count(*)::int from public.shared_collection_members where shared_collection_id = current_setting('test.other')::uuid)
  + (select count(*)::int from public.shared_invites where shared_collection_id = current_setting('test.other')::uuid), 0,
  'a member of one group reads no rows of another');
select throws_ok(format(q, current_setting('test.other'), current_setting('test.b')), '42501', null, 'cross-group: ' || q)
from unnest(array['select * from public.get_shared_members(%L) where %L is not null',
  'select * from public.get_shared_progress(%L) where %L is not null',
  'select * from public.sync_shared_collection(%L, ''NIV'') where %L is not null',
  'select * from public.mint_invite(%L) where %L is not null',
  'select public.leave_shared_collection(%L) where %L is not null',
  'select public.remove_shared_member(%L, %L)',
  'insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end) select %L, ''John'', 1, 1, 1 where %L is not null']) as q;
select results_eq('select shared_id::text from public.get_shared_status()', format('values (%L)', current_setting('test.s')),
  'status lists only the member''s own group');

-- ---------- Invite rotation

select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select public.mint_invite(current_setting('test.s')::uuid);
select public.mint_invite(current_setting('test.s')::uuid);
select is((select count(*)::int from public.shared_invites
  where shared_collection_id = current_setting('test.s')::uuid and revoked_at is null and expires_at > now()), 1,
  'after any number of new links exactly one is live');
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);

-- ---------- Leave

select lives_ok(format('select public.leave_shared_collection(%L)', current_setting('test.s')), 'a member leaves');
select ok((select deleted_at is not null from public.user_collections where client_id = 'shared-' || current_setting('test.s')),
  'the leaver''s local collection is soft-deleted');
select results_eq($$select verse_start, (select count(*)::int from public.verse_collections where verse_id = v.id)
  from public.user_verses v where chapter = 8 order by 1$$,
  $$values (28, 1)$$, 'unmastered copies in no other collection are gone; Romans 8:28 stays in My Verses');
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select throws_ok(format('select public.leave_shared_collection(%L)', current_setting('test.s')), '22023', 'The owner can''t leave',
  'the owner cannot leave');
reset role;
select is((select count(*)::int from public.verse_collections where collection_id in
  ('cccccccc-0000-4000-8000-000000000012', 'dddddddd-0000-4000-8000-000000000012')), 6,
  'a leave deletes nothing of other members');

-- ---------- Remove

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select throws_ok(format('select public.remove_shared_member(%L, %L)', current_setting('test.s'), current_setting('test.c')),
  '22023', 'The owner can''t be removed', 'the owner cannot remove themselves');
select lives_ok(format('select public.remove_shared_member(%L, %L)', current_setting('test.s'), current_setting('test.d')),
  'the owner removes a member');
select is((select count(*)::int from public.verse_collections where collection_id = 'cccccccc-0000-4000-8000-000000000012'), 3,
  'a removal deletes nothing of the owner''s');
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
select is((select count(*)::int from public.shared_collections), 0, 'a removed member reads no group');
select is((select count(*)::int from public.shared_collection_verses), 0, 'a removed member reads no group verses');
select is((select count(*)::int from public.shared_collection_members), 0, 'a removed member reads no members');
select throws_ok(format('select * from public.get_shared_progress(%L)', current_setting('test.s')), '42501', null,
  'a removed member cannot read members'' progress');
select throws_ok(format('select * from public.get_shared_members(%L)', current_setting('test.s')), '42501', null,
  'a removed member cannot list members');
select ok((select deleted_at is not null from public.user_collections where id = 'dddddddd-0000-4000-8000-000000000012'),
  'the removed member''s local collection is soft-deleted');
select results_eq($$select verse_start, deleted_at is not null from public.user_verses where book = 'Romans' order by 1$$,
  $$values (1, true)$$, 'their unmastered copies are gone and the engraved one is soft-deleted');

-- A sync that passed the membership check before the removal committed resumes under its locks,
-- sees the membership gone and writes nothing. (The two-session race itself can't run inside one
-- pgTAP transaction; this calls the helper the way the resumed sync does.)
reset role;
select results_eq(format('select local_client_id, changed from private.sync_member_copies(%L, %L, ''NIV'')',
    current_setting('test.d'), current_setting('test.s')),
  format('values (%L::text, false)', 'shared-' || current_setting('test.s')),
  'a sync for someone no longer a member reports no change');
select ok((select deleted_at is not null from public.user_collections where id = 'dddddddd-0000-4000-8000-000000000012'),
  'that sync leaves the removed copy deleted');
select results_eq(format($$select verse_start, deleted_at is not null from public.user_verses
    where user_id = %L and book = 'Romans' order by 1$$, current_setting('test.d')),
  $$values (1, true)$$, 'and brings back no verse copies');
set local role authenticated;

-- Rejoin with a fresh link: the old row and the kept verse come back.
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select set_config('test.code', (select code from public.mint_invite(current_setting('test.s')::uuid)), true);
select throws_ok($$select * from public.preview_invite('BREAD828')$$, '22023', 'Invite not found', 'a new link revokes the old one');
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
select is(public.join_shared_collection(current_setting('test.code'), 'NIV'), 'shared-' || current_setting('test.s'),
  'a removed member can rejoin with a new link');
select results_eq($$select id::text, deleted_at is null from public.user_collections where client_id like 'shared-%'$$,
  $$values ('dddddddd-0000-4000-8000-000000000012'::text, true)$$, 'rejoining restores the same local collection');
select is((select progress -> 'engraved' -> 'completed' from public.user_verses where id = 'dddddddd-0000-4000-8000-000000000021'),
  'true'::jsonb, 'rejoining restores the engraved verse with its progress');

-- ---------- Dissolve: owner deletes the group

-- The owner adds a reference the member never syncs, then deletes the group.
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end)
values (current_setting('test.s')::uuid, 'Romans', 8, 32, 32);
delete from public.shared_collections where id = current_setting('test.s')::uuid;
reset role;
select is((select shared_collection_id from public.user_collections where id = 'dddddddd-0000-4000-8000-000000000012'), null,
  'the member''s copy becomes a personal collection');
select is((select count(*)::int from public.verse_collections where collection_id = 'dddddddd-0000-4000-8000-000000000012'), 4,
  'the member keeps every verse link');
select is((select count(*)::int from public.user_verses where user_id = current_setting('test.d')::uuid and book = 'Romans' and deleted_at is null), 4,
  'the member keeps every verse');
select is((select version from public.user_verses where user_id = current_setting('test.d')::uuid and verse_start = 32), 'NIV',
  'a reference the member never synced reaches their copy before the group goes, in their translation');
select is((select count(*)::int from public.shared_collection_members where shared_collection_id = current_setting('test.s')::uuid), 0,
  'memberships are gone');
select is((select count(*)::int from public.shared_invites where shared_collection_id = current_setting('test.s')::uuid), 0,
  'invites are gone');

-- ---------- Dissolve: owner deletes their account

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select set_config('test.s2', (select shared_id::text from public.share_collection('seed-romans-8')), true);
select set_config('test.code2', (select code from public.shared_invites where shared_collection_id = current_setting('test.s2')::uuid), true);
select set_config('request.jwt.claim.sub', current_setting('test.d'), true);
select set_config('test.d_local2', public.join_shared_collection(current_setting('test.code2'), 'NIV'), true);
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end)
values (current_setting('test.s2')::uuid, 'Romans', 8, 35, 35);
select public.delete_own_account();
reset role;
select is((select shared_collection_id from public.user_collections
  where user_id = current_setting('test.d')::uuid and client_id = current_setting('test.d_local2')), null,
  'account deletion dissolves the group into the member''s personal copy');
select is((select count(*)::int from public.verse_collections vc join public.user_collections c on c.id = vc.collection_id
  where c.user_id = current_setting('test.d')::uuid and c.client_id = current_setting('test.d_local2')), 4,
  'the member keeps every verse link, the unsynced one included, after the owner deletes their account');
select is((select count(*)::int from public.shared_collections where id = current_setting('test.s2')::uuid), 0,
  'the group is gone with its owner');

select * from finish();
rollback;
