-- What prod runs that was once made by hand: the Verse of the Month count, the two cron
-- schedules, and the RPC that was dropped. All writes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

select has_function('public', 'get_votm_mastery_count', array['text', 'integer', 'integer', 'integer'],
  'the Verse of the Month count exists');
select ok(has_function_privilege('anon', 'public.get_votm_mastery_count(text,integer,integer,integer)', 'EXECUTE'),
  'anonymous calls can run the Verse of the Month count');

insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version, progress)
select u.id, 'drift-test', 'Obadiah', 1, 1, 4, v.version, v.progress::jsonb
from (values
  ('reader-a@example.test', 'ESV', '{"hard":{"completed":true}}'),
  ('reader-b@example.test', 'ESV', '{"hard":{"completed":false}}')
) as v(email, version, progress)
join auth.users u on u.email = v.email;

select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'reader-b@example.test'), true);
set local role authenticated;
select is(public.get_votm_mastery_count('Obadiah', 1, 1, 4), 1, 'the count includes other users'' mastered rows and skips unmastered ones');
select is(public.get_votm_mastery_count('Obadiah', 1, 1, 3), 0, 'the count needs the exact range');
reset role;

select hasnt_function('public', 'get_tier_and_usage', 'get_tier_and_usage is gone');
select is((select schedule from cron.job where jobname = 'update-popular-ranges'), '0 * * * *',
  'popular ranges rebuild hourly');
select is((select schedule from cron.job where jobname = 'vacuum-pg-net-responses'), '17 8 * * *',
  'pg_net''s response table is vacuumed daily');
select is((select command from cron.job where jobname = 'update-popular-ranges'), 'SELECT update_popular_ranges()',
  'the popular ranges job still runs update_popular_ranges');
select is((select command from cron.job where jobname = 'vacuum-pg-net-responses'),
  'VACUUM (INDEX_CLEANUP ON, TRUNCATE FALSE, PARALLEL 0, SKIP_LOCKED TRUE) net._http_response',
  'the pg_net job runs prod''s VACUUM command');

select * from finish();
rollback;
