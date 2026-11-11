begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select count(*) from public.verse_of_month where year_month between '2026-11' and '2036-10'), 120::bigint,
  'the monthly seed covers all 120 months');
select ok(not exists(select 1 from generate_series(0,119) n
  where not exists(select 1 from public.verse_of_month v
    where v.year_month = to_char(date '2026-11-01' + make_interval(months => n), 'YYYY-MM'))),
  'there are no gaps in the seeded schedule');
select is((select count(*) from public.verse_of_month where year_month between '2026-11' and '2036-10'
    and image_url in ('https://bhvvagvnmoxpjgfffgpl.supabase.co/storage/v1/object/public/images/vtm-gold-trees.png',
      'https://bhvvagvnmoxpjgfffgpl.supabase.co/storage/v1/object/public/images/vtm-dark-sky.png')),
  120::bigint, 'every seeded month has one of the two public artwork URLs');
select ok(not exists(select 1 from generate_series(0,119) n
  join public.verse_of_month v on v.year_month = to_char(date '2026-11-01' + make_interval(months => n), 'YYYY-MM')
  where v.image_url not like '%/' || case when n % 2 = 0 then 'vtm-gold-trees.png' else 'vtm-dark-sky.png' end),
  'artwork alternates gold trees then dark sky from November 2026');
select ok((select relrowsecurity from pg_class where oid='public.user_intro_presentations'::regclass), 'intro state has RLS');
select ok(not has_table_privilege('anon','public.user_intro_presentations','SELECT,INSERT,UPDATE,DELETE'), 'anonymous clients have no intro access');
select ok(has_table_privilege('authenticated','public.user_intro_presentations','SELECT,INSERT'), 'owners can read and insert their marker');
select ok(not has_table_privilege('authenticated','public.user_intro_presentations','UPDATE,DELETE'), 'clients cannot reset or reassign a marker');
select ok(not has_function_privilege('anon','public.claim_intro_presentation(text)','EXECUTE'), 'anonymous clients cannot claim an intro');
select ok(has_function_privilege('authenticated','public.claim_intro_presentation(text)','EXECUTE'), 'authenticated clients can claim');
select ok(not (select prosecdef from pg_proc where oid='public.claim_intro_presentation(text)'::regprocedure), 'claim respects invoker access');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.claim_intro_presentation(text)'::regprocedure), 'claim pins its search path');
select set_config('test.intro_a',(select id::text from auth.users where email='reader-a@example.test'),true);
select set_config('test.intro_b',(select id::text from auth.users where email='reader-b@example.test'),true);

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.intro_a'),true);
select is(public.claim_intro_presentation('scripture-encouragement'),true,'the first device wins the account claim');
select is(public.claim_intro_presentation('scripture-encouragement'),false,'a repeat launch or second device cannot claim again');
select is((select count(*) from public.user_intro_presentations),1::bigint,'the owner can read its single marker');
select throws_ok($$insert into public.user_intro_presentations(user_id,intro_id) values(current_setting('test.intro_b')::uuid,'forged')$$,
  '42501','new row violates row-level security policy for table "user_intro_presentations"','an account cannot mark another account as seen');
select throws_ok($$update public.user_intro_presentations set intro_id='changed'$$,'42501','permission denied for table user_intro_presentations','markers cannot be edited');
select throws_ok($$delete from public.user_intro_presentations$$,'42501','permission denied for table user_intro_presentations','markers cannot be deleted by clients');
select throws_ok($$select public.claim_intro_presentation('')$$,'22023','Invalid intro ID','empty IDs are rejected');
select throws_ok($$select public.claim_intro_presentation(repeat('a',81))$$,'22023','Invalid intro ID','IDs are bounded');
select set_config('request.jwt.claim.sub',current_setting('test.intro_b'),true);
select is((select count(*) from public.user_intro_presentations),0::bigint,'another account cannot read the first account marker');
select is(public.claim_intro_presentation('scripture-encouragement'),true,'each account has its own first opportunity');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.claim_intro_presentation('scripture-encouragement')$$,'42501','Authentication required','a missing caller cannot claim');
reset role;

select set_config('test.deleted_intro_user',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.deleted_intro_user')::uuid);
insert into public.user_intro_presentations(user_id,intro_id) values(current_setting('test.deleted_intro_user')::uuid,'scripture-encouragement');
delete from auth.users where id=current_setting('test.deleted_intro_user')::uuid;
select is((select count(*) from public.user_intro_presentations where user_id=current_setting('test.deleted_intro_user')::uuid),0::bigint,
  'account deletion cascades its intro marker');
select * from finish();
rollback;
