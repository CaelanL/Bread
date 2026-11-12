-- Local test logins, all at @example.test, password password123. Runs only on local databases.
-- reader-a@example.test: a small library and a 5-day streak, so screens aren't empty.
-- reader-b@example.test: brand new, for the first-run flow.
-- reader-c@example.test (Cara, ESV) owns the shared collection "Romans 8"; reader-d@example.test
-- (Dana, NIV) is a member. Romans 8:1 is engraved by both, 8:28 mastered by Cara and learning
-- for Dana, 8:38-39 untouched. Invite code BREAD828. Neither shares anything with reader-a or b.
-- Cara also has one collection per Library emblem: "Psalm 23" (mastered), "John 15" (engraved),
-- "Philippians 4" (shared with reader-e and reader-f, mastered by everyone) and "Joshua 1"
-- (shared with reader-g, engraved by everyone); and owns "Sermon on the Mount", 10 members
-- (Cara plus reader-e to reader-m: Eli, Faith, Gabe, Hana, Isaac, Jo, Kai, Lena, Micah) on
-- 6 references in every state, so Who's where scrolls sideways. Only Romans 8 has an invite.

-- Local cron must never call prod (migration 017 schedules a call to the prod URL).
select cron.unschedule(jobname) from cron.job where command like '%supabase.co%';

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-a@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now() - interval '30 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-b@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'),
  ('cccccccc-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-c@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now() - interval '14 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'),
  ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-d@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now() - interval '7 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}');

-- Members of Cara's other groups: reader-e (n = 1) to reader-m (n = 9).
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data)
select format('00000000-0000-4000-8000-%s', lpad((100 + n)::text, 12, '0'))::uuid, '00000000-0000-0000-0000-000000000000',
  format('reader-%s@example.test', chr(100 + n)), crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated',
  now() - interval '9 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'
from generate_series(1, 9) as n;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()
from auth.users;

insert into public.user_collections (id, user_id, client_id, name, is_default, created_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000001', 'my-verses', 'My Verses', true, now() - interval '30 days'),
  ('aaaaaaaa-0000-4000-8000-000000000012', 'aaaaaaaa-0000-4000-8000-000000000001', 'seed-psalms', 'Psalms', false, now() - interval '20 days');

insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress, created_at, last_practiced_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000001', 'seed-john-3-16', 'John', 3, 16, 16, 'ESV',
    '{"easy":{"bestAccuracy":100,"completed":true},"medium":{"bestAccuracy":96,"completed":true},"hard":{"bestAccuracy":92,"completed":true},"engraved":{"completed":false,"passCount":1,"lifetimeReviews":1,"nextDueAt":null,"lastReviewedAt":null,"months":[]}}',
    now() - interval '30 days', now() - interval '1 day'),
  ('aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000001', 'seed-romans-8-28', 'Romans', 8, 28, 28, 'ESV',
    '{"easy":{"bestAccuracy":95,"completed":true},"medium":{"bestAccuracy":70,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}',
    now() - interval '20 days', now()),
  ('aaaaaaaa-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000001', 'seed-psalm-23-1-3', 'Psalms', 23, 1, 3, 'ESV',
    '{"easy":{"bestAccuracy":null,"completed":false},"medium":{"bestAccuracy":null,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}',
    now() - interval '10 days', null);

insert into public.verse_collections (verse_id, collection_id)
values
  ('aaaaaaaa-0000-4000-8000-000000000021', 'aaaaaaaa-0000-4000-8000-000000000011'),
  ('aaaaaaaa-0000-4000-8000-000000000022', 'aaaaaaaa-0000-4000-8000-000000000011'),
  ('aaaaaaaa-0000-4000-8000-000000000023', 'aaaaaaaa-0000-4000-8000-000000000012');

-- One attempt a day for the last 5 days, so the streak is 5.
insert into public.session_attempts (user_id, book, chapter, verse_start, verse_end, version, difficulty, chunk_size, accuracy, recording_duration_ms, word_count, created_at)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'Romans', 8, 28, 28, 'ESV', 'easy', 1, 80 + day * 3, 40000, 25, now() - make_interval(days => day)
from generate_series(0, 4) as day;

insert into public.session_attempts (user_id, book, chapter, verse_start, verse_end, version, difficulty, chunk_size, accuracy, recording_duration_ms, word_count, created_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'John', 3, 16, 16, 'ESV', 'hard', 1, 92, 30000, 25, now() - interval '1 day');

insert into public.user_stats (user_id, avg_time_per_word_ms, total_words_mastered)
values ('aaaaaaaa-0000-4000-8000-000000000001', null, 25);

-- The shared group: Cara's own collection plus Dana's member copy, linked by shared_collection_id.
insert into public.profiles (user_id, translation, display_name)
values
  ('cccccccc-0000-4000-8000-000000000001', 'ESV', 'Cara'),
  ('dddddddd-0000-4000-8000-000000000001', 'NIV', 'Dana');

insert into public.shared_collections (id, owner_id, name, icon_key, created_at)
values ('cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000001', 'Romans 8', 'heart', now() - interval '10 days');

insert into public.shared_collection_members (shared_collection_id, user_id, role, joined_at)
values
  ('cccccccc-0000-4000-8000-000000000031', 'cccccccc-0000-4000-8000-000000000001', 'owner', now() - interval '10 days'),
  ('cccccccc-0000-4000-8000-000000000031', 'dddddddd-0000-4000-8000-000000000001', 'member', now() - interval '6 days');

insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end, added_by, added_at)
values
  ('cccccccc-0000-4000-8000-000000000031', 'Romans', 8, 1, 1, 'cccccccc-0000-4000-8000-000000000001', now() - interval '10 days'),
  ('cccccccc-0000-4000-8000-000000000031', 'Romans', 8, 28, 28, 'cccccccc-0000-4000-8000-000000000001', now() - interval '10 days'),
  ('cccccccc-0000-4000-8000-000000000031', 'Romans', 8, 38, 39, 'cccccccc-0000-4000-8000-000000000001', now() - interval '10 days');

insert into public.shared_invites (shared_collection_id, code, created_at, expires_at)
values ('cccccccc-0000-4000-8000-000000000031', 'BREAD828', now() - interval '1 day', now() + interval '13 days');

insert into public.user_collections (id, user_id, client_id, name, icon_key, shared_collection_id, created_at)
values
  ('cccccccc-0000-4000-8000-000000000012', 'cccccccc-0000-4000-8000-000000000001', 'seed-romans-8', 'Romans 8', 'heart', 'cccccccc-0000-4000-8000-000000000031', now() - interval '12 days'),
  ('dddddddd-0000-4000-8000-000000000012', 'dddddddd-0000-4000-8000-000000000001', 'shared-cccccccc-0000-4000-8000-000000000031', 'Romans 8', 'heart', 'cccccccc-0000-4000-8000-000000000031', now() - interval '6 days');

insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress, created_at, last_practiced_at)
select id::uuid, user_id::uuid, client_id, 'Romans', 8, vs, ve, version, progress::jsonb, now() - interval '6 days', practiced
from (values
  ('cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000001', 'seed-c-romans-8-1', 1, 1, 'ESV', 'engraved', now() - interval '1 day'),
  ('cccccccc-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000001', 'seed-c-romans-8-28', 28, 28, 'ESV', 'mastered', now() - interval '2 days'),
  ('cccccccc-0000-4000-8000-000000000023', 'cccccccc-0000-4000-8000-000000000001', 'seed-c-romans-8-38-39', 38, 39, 'ESV', 'open', null),
  ('dddddddd-0000-4000-8000-000000000021', 'dddddddd-0000-4000-8000-000000000001', 'seed-d-romans-8-1', 1, 1, 'NIV', 'engraved', now() - interval '1 day'),
  ('dddddddd-0000-4000-8000-000000000022', 'dddddddd-0000-4000-8000-000000000001', 'seed-d-romans-8-28', 28, 28, 'NIV', 'learning', now() - interval '1 day'),
  ('dddddddd-0000-4000-8000-000000000023', 'dddddddd-0000-4000-8000-000000000001', 'seed-d-romans-8-38-39', 38, 39, 'NIV', 'open', null)
) as v(id, user_id, client_id, vs, ve, version, state, practiced)
join (values
  ('open', '{"easy":{"bestAccuracy":null,"completed":false},"medium":{"bestAccuracy":null,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}'),
  ('learning', '{"easy":{"bestAccuracy":85,"completed":false},"medium":{"bestAccuracy":null,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}'),
  ('mastered', '{"easy":{"bestAccuracy":100,"completed":true},"medium":{"bestAccuracy":95,"completed":true},"hard":{"bestAccuracy":92,"completed":true},"engraved":{"completed":false,"passCount":2,"lifetimeReviews":2,"nextDueAt":null,"lastReviewedAt":null,"months":[]}}'),
  ('engraved', '{"easy":{"bestAccuracy":100,"completed":true},"medium":{"bestAccuracy":98,"completed":true},"hard":{"bestAccuracy":96,"completed":true},"engraved":{"completed":true,"passCount":10,"lifetimeReviews":10,"nextDueAt":null,"lastReviewedAt":null,"months":[]}}')
) as p(state, progress) using (state);

insert into public.verse_collections (verse_id, collection_id)
values
  ('cccccccc-0000-4000-8000-000000000021', 'cccccccc-0000-4000-8000-000000000012'),
  ('cccccccc-0000-4000-8000-000000000022', 'cccccccc-0000-4000-8000-000000000012'),
  ('cccccccc-0000-4000-8000-000000000023', 'cccccccc-0000-4000-8000-000000000012'),
  ('dddddddd-0000-4000-8000-000000000021', 'dddddddd-0000-4000-8000-000000000012'),
  ('dddddddd-0000-4000-8000-000000000022', 'dddddddd-0000-4000-8000-000000000012'),
  ('dddddddd-0000-4000-8000-000000000023', 'dddddddd-0000-4000-8000-000000000012');

-- Cara's other groups and solo emblems. Ids are derived (md5) so the inserts can join on them.
create temp table seed_people (n int primary key, user_id uuid, name text, translation text);
insert into seed_people
select n, format('00000000-0000-4000-8000-%s', lpad((100 + n)::text, 12, '0'))::uuid, name, translation
from (values (1, 'Eli', 'ESV'), (2, 'Faith', 'NIV'), (3, 'Gabe', 'ESV'), (4, 'Hana', 'ESV'), (5, 'Isaac', 'NIV'),
  (6, 'Jo', 'ESV'), (7, 'Kai', 'ESV'), (8, 'Lena', 'NIV'), (9, 'Micah', 'ESV')) as p(n, name, translation)
union all select 0, 'cccccccc-0000-4000-8000-000000000001', 'Cara', 'ESV';

insert into public.profiles (user_id, translation, display_name)
select user_id, translation, name from seed_people where n > 0;

-- g: 32 Sermon on the Mount, 33 Philippians 4, 34 Joshua 1; 0 for Cara's solo collections.
create temp table seed_groups (g int primary key, id uuid, client_id text, name text, icon_key text, created_at timestamptz);
insert into seed_groups values
  (32, 'cccccccc-0000-4000-8000-000000000032', 'seed-sermon-mount', 'Sermon on the Mount', 'mountain', now() - interval '9 days'),
  (33, 'cccccccc-0000-4000-8000-000000000033', 'seed-philippians-4', 'Philippians 4', 'dove', now() - interval '8 days'),
  (34, 'cccccccc-0000-4000-8000-000000000034', 'seed-joshua-1', 'Joshua 1', 'shield', now() - interval '7 days'),
  (35, null, 'seed-psalm-23', 'Psalm 23', 'sunrise', now() - interval '6 days'),
  (36, null, 'seed-john-15', 'John 15', 'leaf', now() - interval '5 days');

create temp table seed_refs (g int, ord int, book text, chapter int, vs int, ve int);
insert into seed_refs values
  (32, 1, 'Matthew', 5, 3, 3), (32, 2, 'Matthew', 5, 14, 16), (32, 3, 'Matthew', 5, 44, 44),
  (32, 4, 'Matthew', 6, 9, 13), (32, 5, 'Matthew', 6, 33, 33), (32, 6, 'Matthew', 7, 7, 7),
  (33, 1, 'Philippians', 4, 6, 7), (33, 2, 'Philippians', 4, 13, 13),
  (34, 1, 'Joshua', 1, 8, 8), (34, 2, 'Joshua', 1, 9, 9),
  (35, 1, 'Psalms', 23, 1, 1), (35, 2, 'Psalms', 23, 4, 4),
  (36, 1, 'John', 15, 5, 5), (36, 2, 'John', 15, 7, 7);

-- One letter per reference in order: o open, l learning, m mastered, e engraved.
create temp table seed_cells (g int, n int, role text, states text, joined_at timestamptz);
insert into seed_cells values
  (32, 0, 'owner', 'emmlol', now() - interval '9 days'),
  (32, 1, 'editor', 'eemmlo', now() - interval '8 days'),
  (32, 2, 'member', 'mmlooo', now() - interval '8 days'),
  (32, 3, 'member', 'emmmml', now() - interval '7 days'),
  (32, 4, 'member', 'lloooo', now() - interval '6 days'),
  (32, 5, 'member', 'mmmeml', now() - interval '6 days'),
  (32, 6, 'member', 'oooooo', now() - interval '3 days'),
  (32, 7, 'member', 'eeemmm', now() - interval '5 days'),
  (32, 8, 'member', 'mllolo', now() - interval '4 days'),
  (32, 9, 'member', 'mmoooo', now() - interval '2 days'),
  (33, 0, 'owner', 'me', now() - interval '8 days'),
  (33, 1, 'member', 'mm', now() - interval '7 days'),
  (33, 2, 'member', 'em', now() - interval '7 days'),
  (34, 0, 'owner', 'ee', now() - interval '7 days'),
  (34, 3, 'member', 'ee', now() - interval '6 days'),
  (35, 0, null, 'me', null),
  (36, 0, null, 'ee', null);

create temp table seed_progress (code text primary key, progress jsonb);
insert into seed_progress values
  ('o', '{"easy":{"bestAccuracy":null,"completed":false},"medium":{"bestAccuracy":null,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}'),
  ('l', '{"easy":{"bestAccuracy":85,"completed":false},"medium":{"bestAccuracy":null,"completed":false},"hard":{"bestAccuracy":null,"completed":false}}'),
  ('m', '{"easy":{"bestAccuracy":100,"completed":true},"medium":{"bestAccuracy":95,"completed":true},"hard":{"bestAccuracy":92,"completed":true},"engraved":{"completed":false,"passCount":2,"lifetimeReviews":2,"nextDueAt":null,"lastReviewedAt":null,"months":[]}}'),
  ('e', '{"easy":{"bestAccuracy":100,"completed":true},"medium":{"bestAccuracy":98,"completed":true},"hard":{"bestAccuracy":96,"completed":true},"engraved":{"completed":true,"passCount":10,"lifetimeReviews":10,"nextDueAt":null,"lastReviewedAt":null,"months":[]}}');

insert into public.shared_collections (id, owner_id, name, icon_key, created_at)
select id, 'cccccccc-0000-4000-8000-000000000001', name, icon_key, created_at from seed_groups where id is not null;

insert into public.shared_collection_members (shared_collection_id, user_id, role, joined_at)
select sg.id, p.user_id, c.role, c.joined_at
from seed_cells c join seed_groups sg using (g) join seed_people p using (n)
where sg.id is not null;

insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end, added_by, added_at)
select sg.id, r.book, r.chapter, r.vs, r.ve, 'cccccccc-0000-4000-8000-000000000001', sg.created_at
from seed_refs r join seed_groups sg using (g)
where sg.id is not null;

-- Cara's copy keeps her own client id; a member's is shared-<group id>, as join makes it.
insert into public.user_collections (id, user_id, client_id, name, icon_key, shared_collection_id, created_at)
select md5(p.user_id::text || sg.g)::uuid, p.user_id,
  case when p.n = 0 then sg.client_id else 'shared-' || sg.id end,
  sg.name, sg.icon_key, sg.id, coalesce(c.joined_at, sg.created_at)
from seed_cells c join seed_groups sg using (g) join seed_people p using (n);

insert into public.user_verses (id, user_id, client_id, book, chapter, verse_start, verse_end, version, progress, created_at, last_practiced_at)
select md5(p.user_id::text || r.g || '-' || r.ord)::uuid, p.user_id, format('seed-%s-%s', r.g, r.ord),
  r.book, r.chapter, r.vs, r.ve, p.translation, sp.progress, sg.created_at,
  case when lower(substr(c.states, r.ord, 1)) = 'o' then null else now() - make_interval(days => r.ord) end
from seed_cells c
join seed_groups sg using (g)
join seed_people p using (n)
join seed_refs r using (g)
join seed_progress sp on sp.code = lower(substr(c.states, r.ord, 1));

insert into public.verse_collections (verse_id, collection_id)
select md5(p.user_id::text || r.g || '-' || r.ord)::uuid, md5(p.user_id::text || c.g)::uuid
from seed_cells c join seed_people p using (n) join seed_refs r using (g);

drop table seed_people, seed_groups, seed_refs, seed_cells, seed_progress;
