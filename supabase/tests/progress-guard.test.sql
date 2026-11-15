begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- reader-b starts empty. One verse, last updated an hour ago (inside one transaction now() doesn't
-- move, so the fixture's updated_at is set in the past and the trigger's now() differs from it).
select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);

insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version, progress)
values (current_setting('test.reader_b')::uuid, 'guarded', 'John', 1, 1, 1, 'ESV', '{"hard":{"bestAccuracy":80,"completed":false}}');
alter table public.user_verses disable trigger update_user_verses_updated_at;
update public.user_verses set updated_at = '2026-01-01 10:00:00.123456+00' where client_id = 'guarded';
alter table public.user_verses enable trigger update_user_verses_updated_at;

select ok(not has_function_privilege('anon', 'public.save_verse_progress(text,timestamptz,jsonb,timestamptz)', 'EXECUTE'),
  'anonymous API calls cannot save progress');
select is((select prosecdef from pg_proc where oid = 'public.save_verse_progress(text,timestamptz,jsonb,timestamptz)'::regprocedure), false,
  'save_verse_progress runs with caller privileges');

set local role authenticated;

-- Another account names reader-b's verse: nothing back, nothing changed.
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select is((select count(*)::int from public.save_verse_progress('guarded', '2026-01-01 10:00:00.123456+00',
  '{"hard":{"bestAccuracy":10,"completed":false}}', now())), 0, 'another account gets no row');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select is((select progress -> 'hard' ->> 'bestAccuracy' from public.user_verses where client_id = 'guarded'), '80',
  'and changed nothing');

-- A stale base is refused and the current row comes back.
select is((select applied from public.save_verse_progress('guarded', '2026-01-01 09:00:00+00',
  '{"hard":{"bestAccuracy":60,"completed":false}}', now())), false, 'a stale updated_at is refused');
select is((select progress -> 'hard' ->> 'bestAccuracy' from public.save_verse_progress('guarded', '2026-01-01 09:00:00+00',
  '{"hard":{"bestAccuracy":60,"completed":false}}', now())), '80', 'and returns the server''s progress');
select is((select updated_at from public.save_verse_progress('guarded', null, '{}', now())),
  '2026-01-01 10:00:00.123456+00'::timestamptz, 'an unknown base is refused too, with the server''s updated_at to the microsecond');
select is((select progress -> 'hard' ->> 'bestAccuracy' from public.user_verses where client_id = 'guarded'), '80',
  'refusals changed nothing');

-- The matching base applies.
select is((select applied from public.save_verse_progress('guarded', '2026-01-01 10:00:00.123456+00',
  '{"hard":{"bestAccuracy":92,"completed":true}}', '2026-01-02 08:00:00+00')), true, 'a matching updated_at applies');
select is((select progress -> 'hard' ->> 'bestAccuracy' from public.user_verses where client_id = 'guarded'), '92',
  'the new progress is saved');
select is((select last_practiced_at from public.user_verses where client_id = 'guarded'), '2026-01-02 08:00:00+00'::timestamptz,
  'and the practice time');
select isnt((select updated_at from public.user_verses where client_id = 'guarded'), '2026-01-01 10:00:00.123456+00'::timestamptz,
  'and updated_at moved, so the old base is now stale');

-- Null progress keeps the row's and still saves the practice time.
select is((select applied from public.save_verse_progress('guarded', (select updated_at from public.user_verses where client_id = 'guarded'),
  null, '2026-01-03 08:00:00+00')), true, 'a null progress applies');
select is((select progress -> 'hard' ->> 'bestAccuracy' from public.user_verses where client_id = 'guarded'), '92',
  'and keeps the progress');

select * from finish();
rollback;
