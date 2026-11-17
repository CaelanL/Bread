-- Feedback reports and photos: clients insert only, into their own rows and folder.
-- The real upload, account delete and photo sweep run in tests/feedback-photos.integration.ts.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select set_config('test.fb_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.fb_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);

select ok((select relrowsecurity from pg_class where oid = 'public.feedback_reports'::regclass), 'reports have RLS');
select ok(not has_table_privilege('anon', 'public.feedback_reports', 'SELECT,INSERT,UPDATE,DELETE'), 'anonymous clients have no report access');
select ok(has_table_privilege('authenticated', 'public.feedback_reports', 'INSERT'), 'signed-in clients can send a report');
select ok(not has_table_privilege('authenticated', 'public.feedback_reports', 'SELECT,UPDATE,DELETE'), 'signed-in clients cannot read, edit or delete reports');
select ok(not has_function_privilege('anon', 'public.orphaned_feedback_photos()', 'EXECUTE'), 'anonymous clients cannot list orphaned photos');
select ok(not has_function_privilege('authenticated', 'public.orphaned_feedback_photos()', 'EXECUTE'), 'signed-in clients cannot list orphaned photos');
select ok(has_function_privilege('service_role', 'public.orphaned_feedback_photos()', 'EXECUTE'), 'the sweep can list orphaned photos');
select is((select public from storage.buckets where id = 'feedback-photos'), false, 'the photo bucket is private');
select is((select file_size_limit from storage.buckets where id = 'feedback-photos'), 5242880::bigint, 'photos are capped at 5 MB');
select is((select allowed_mime_types from storage.buckets where id = 'feedback-photos'), array['image/*'], 'the bucket takes images only');

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.fb_a'), true);
select lives_ok($$insert into public.feedback_reports (kind, note, details) values ('grading', 'It marked "wages" wrong', '{"score": 80}')$$,
  'a signed-in reader sends a grading report, user id from the session');
select lives_ok($$insert into public.feedback_reports (user_id, kind, label, note, photo_paths)
  values (current_setting('test.fb_a')::uuid, 'general', 'idea', 'More translations', array[current_setting('test.fb_a') || '/one.jpg'])$$,
  'a reader sends feedback with a photo in their own folder');
select set_config('test.fb_report', gen_random_uuid()::text, true);
select lives_ok($$insert into public.feedback_reports (id, kind, note) values (current_setting('test.fb_report')::uuid, 'grading', 'first try')$$,
  'a report can carry the id the app made for it');
select throws_ok($$insert into public.feedback_reports (id, kind, note) values (current_setting('test.fb_report')::uuid, 'grading', 'retry')$$,
  '23505', null, 'a retry with the same report id cannot save the report twice');
select throws_ok($$insert into public.feedback_reports (user_id, kind, note) values (current_setting('test.fb_b')::uuid, 'general', 'forged')$$,
  '42501', 'new row violates row-level security policy for table "feedback_reports"', 'a reader cannot send as another account');
select throws_ok($$insert into public.feedback_reports (kind, note, photo_paths) values ('general', 'hi', array[current_setting('test.fb_b') || '/x.jpg'])$$,
  '42501', 'new row violates row-level security policy for table "feedback_reports"', 'a report cannot point at another account''s photos');
select throws_ok($$insert into public.feedback_reports (kind, note) values ('general', '   ')$$,
  '23514', null, 'a note is required');
select throws_ok($$insert into public.feedback_reports (kind, note) values ('general', repeat('a', 4001))$$,
  '23514', null, 'notes are bounded');
select throws_ok($$insert into public.feedback_reports (kind, note, photo_paths)
  values ('general', 'four', array[current_setting('test.fb_a') || '/1', current_setting('test.fb_a') || '/2', current_setting('test.fb_a') || '/3', current_setting('test.fb_a') || '/4'])$$,
  '23514', null, 'at most three photos');
select throws_ok($$select * from public.feedback_reports$$, '42501', 'permission denied for table feedback_reports', 'a reader cannot read reports');
select throws_ok($$update public.feedback_reports set note = 'x'$$, '42501', 'permission denied for table feedback_reports', 'a reader cannot edit reports');
select throws_ok($$delete from public.feedback_reports$$, '42501', 'permission denied for table feedback_reports', 'a reader cannot delete reports');

select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-photos', current_setting('test.fb_a') || '/one.jpg', current_setting('test.fb_a'))$$,
  'a reader uploads into their own folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-photos', current_setting('test.fb_b') || '/x.jpg', current_setting('test.fb_a'))$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'a reader cannot upload into another folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('feedback-photos', 'loose.jpg', current_setting('test.fb_a'))$$,
  '42501', 'new row violates row-level security policy for table "objects"', 'a reader cannot upload outside a folder');
select is((select count(*) from storage.objects where bucket_id = 'feedback-photos'), 0::bigint, 'a reader cannot read or list photos, even their own');
reset role;

set local role anon;
select throws_ok($$insert into public.feedback_reports (user_id, kind, note) values (current_setting('test.fb_a')::uuid, 'general', 'anon')$$,
  '42501', 'permission denied for table feedback_reports', 'anonymous clients cannot send');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('feedback-photos', current_setting('test.fb_a') || '/anon.jpg')$$,
  '42501', null, 'anonymous clients cannot upload');
select is((select count(*) from storage.objects where bucket_id = 'feedback-photos'), 0::bigint, 'anonymous clients cannot list photos');
reset role;

select is((select count(*) from public.feedback_reports where user_id = current_setting('test.fb_a')::uuid), 3::bigint, 'each report landed once');

-- A deleted account: its rows cascade and its photos turn up for the sweep; a live account's don't.
select set_config('test.fb_gone', gen_random_uuid()::text, true);
insert into auth.users (id) values (current_setting('test.fb_gone')::uuid);
insert into public.feedback_reports (user_id, kind, note, photo_paths)
  values (current_setting('test.fb_gone')::uuid, 'general', 'bye', array[current_setting('test.fb_gone') || '/p.jpg']);
insert into storage.objects (bucket_id, name, owner_id) values ('feedback-photos', current_setting('test.fb_gone') || '/p.jpg', current_setting('test.fb_gone'));
select is((select count(*) from public.orphaned_feedback_photos()), 0::bigint, 'no photo is orphaned while its account exists');
delete from auth.users where id = current_setting('test.fb_gone')::uuid;
select is((select count(*) from public.feedback_reports where user_id = current_setting('test.fb_gone')::uuid), 0::bigint,
  'account deletion cascades its reports');
select is(array(select public.orphaned_feedback_photos()), array[current_setting('test.fb_gone') || '/p.jpg'],
  'the deleted account''s photo, and only it, is left for the sweep');

select is((select count(*) from cron.job where jobname = 'delete-feedback-photos'), 0::bigint,
  'the local seed unscheduled the prod sweep call');

select * from finish();
rollback;
