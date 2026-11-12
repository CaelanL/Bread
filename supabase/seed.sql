-- Local test logins, all at @example.test, password password123. Runs only on local databases.
-- reader-a@example.test: a small library and a 5-day streak, so screens aren't empty.
-- reader-b@example.test: brand new, for the first-run flow.
-- reader-c@example.test (Cara, ESV) owns the shared collection "Romans 8"; reader-d@example.test
-- (Dana, NIV) is a member. Romans 8:1 is engraved by both, 8:28 mastered by Cara and learning
-- for Dana, 8:38-39 untouched. Invite code BREAD828. Neither shares anything with reader-a or b.

-- Local cron must never call prod (migration 017 schedules a call to the prod URL).
select cron.unschedule(jobname) from cron.job where command like '%supabase.co%';

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-a@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now() - interval '30 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-b@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now(), now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'),
  ('cccccccc-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-c@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now() - interval '14 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}'),
  ('dddddddd-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'reader-d@example.test', crypt('password123', gen_salt('bf')), now(), 'authenticated', 'authenticated', now() - interval '7 days', now(), '', '', '', '', '{"provider":"email","providers":["email"]}', '{}');

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
