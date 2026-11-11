begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select ok((select relrowsecurity from pg_class
  where oid = 'public.curated_collection_savers'::regclass), 'the saver ledger has RLS');
select ok(not has_table_privilege('authenticated', 'public.curated_collection_savers', 'SELECT'),
  'clients cannot read saver identities');
select ok(not has_table_privilege('authenticated', 'public.curated_collection_savers', 'INSERT,UPDATE,DELETE'),
  'clients cannot write the ledger directly');
select ok(not has_table_privilege('anon', 'public.curated_collection_savers', 'SELECT,INSERT,UPDATE,DELETE'),
  'anonymous clients have no ledger access');
select ok(not has_function_privilege('anon', 'public.get_curated_collection_saver_counts(text[])', 'EXECUTE'),
  'anonymous clients cannot read totals');
select ok(has_function_privilege('authenticated', 'public.get_curated_collection_saver_counts(text[])', 'EXECUTE'),
  'authenticated clients can read totals');
select ok(not has_function_privilege('anon', 'private.read_curated_collection_savers(text[])', 'EXECUTE'),
  'anonymous clients cannot call the private reader');
select ok(not has_function_privilege('anon', 'private.record_curated_collection_save(text,uuid)', 'EXECUTE'),
  'anonymous clients cannot call the private writer');
select ok(not has_function_privilege('authenticated', 'private.curated_catalog_ids()', 'EXECUTE'),
  'the internal catalog helper is not a client API');
select ok(not (select prosecdef from pg_proc
  where oid = 'public.import_curated_collection(text,text,text,text,jsonb)'::regprocedure),
  'import retains invoker access rules');
select ok(not (select prosecdef from pg_proc
  where oid = 'public.get_curated_collection_saver_counts(text[])'::regprocedure),
  'the public count wrapper is invoker');
select ok((select bool_and(proconfig @> array['search_path=""']) from pg_proc where oid in (
  'private.read_curated_collection_savers(text[])'::regprocedure,
  'private.record_curated_collection_save(text,uuid)'::regprocedure)),
  'privileged helpers pin an empty search path');

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.passages', '[{"book":"John","chapter":3,"verse_start":16,"verse_end":16}]', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select results_eq($$select * from public.get_curated_collection_saver_counts(array['hope'])$$,
  $$values ('hope'::text, 0::bigint)$$, 'a preview reads a real zero without contributing');
select throws_ok($$select * from public.curated_collection_savers$$, '42501',
  'permission denied for table curated_collection_savers', 'authenticated clients cannot read ledger rows');
select throws_ok($$insert into public.curated_collection_savers(catalog_id,user_id) values ('hope',auth.uid())$$,
  '42501', 'permission denied for table curated_collection_savers', 'authenticated clients cannot forge a contribution');

select set_config('test.saved_id', public.import_curated_collection(
  'hope', 'Hope', 'sunrise', 'KJV', current_setting('test.passages')::jsonb
)::text, true);
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 1::bigint,
  'a successful import contributes once');
select public.import_curated_collection('hope', 'Hope', 'sunrise', 'KJV', current_setting('test.passages')::jsonb);
select public.import_curated_collection('hope', 'Hope', 'sunrise', 'ESV', current_setting('test.passages')::jsonb);
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 1::bigint,
  'retrying and importing another translation do not add another saver');

update public.user_collections set name = 'My completely different collection', icon_key = 'heart'
where id = current_setting('test.saved_id')::uuid;
delete from public.verse_collections where collection_id = current_setting('test.saved_id')::uuid;
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 1::bigint,
  'renaming, changing the icon and removing every passage leave the contribution');
update public.user_collections set deleted_at = now() where client_id like 'curated-hope-%';
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 1::bigint,
  'deleting every translated copy does not remove the contribution');
select public.import_curated_collection('hope', 'Hope', 'sunrise', 'KJV', current_setting('test.passages')::jsonb);
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 1::bigint,
  'explicit re-add leaves the all-time total unchanged');

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select throws_ok($$select private.record_curated_collection_save('hope',current_setting('test.saved_id')::uuid)$$,
  '42501', 'Collection does not belong to this import', 'the writer rejects another account’s collection');
select public.import_curated_collection('hope', 'Hope', 'sunrise', 'KJV', current_setting('test.passages')::jsonb);
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 2::bigint,
  'a second account contributes a second saver');
select results_eq($$select * from public.get_curated_collection_saver_counts(array['prayer','hope','hope']) order by catalog_id$$,
  $$values ('hope'::text,2::bigint), ('prayer'::text,0::bigint)$$,
  'the API returns only deduplicated requested IDs and counts, including zero');
select throws_ok($$select * from public.get_curated_collection_saver_counts(array_fill('hope'::text,array[51]))$$,
  '22023', 'Invalid catalog IDs', 'aggregate requests are bounded');
select throws_ok($$select * from public.get_curated_collection_saver_counts(array[null::text])$$,
  '22023', 'Invalid catalog IDs', 'null IDs are rejected');
select throws_ok($$select * from public.get_curated_collection_saver_counts(array['bad id'])$$,
  '22023', 'Invalid catalog IDs', 'malformed IDs are rejected');

reset role;
create function pg_temp.reject_saver_test_verse() returns trigger language plpgsql as $$
begin
  if new.book = 'John' and new.chapter = 21 and new.verse_start = 25 then
    raise exception 'Fixture rejected';
  end if;
  return new;
end;
$$;
create trigger reject_saver_test_verse before insert on public.user_verses
for each row execute function pg_temp.reject_saver_test_verse();
set local role authenticated;
select throws_ok($$select public.import_curated_collection('prayer','Prayer','book','KJV',
  '[{"book":"John","chapter":21,"verse_start":24,"verse_end":24},
    {"book":"John","chapter":21,"verse_start":25,"verse_end":25}]')$$,
  'P0001', 'Fixture rejected', 'a failed later passage rolls back the import');
select is((select saver_count from public.get_curated_collection_saver_counts(array['prayer'])), 0::bigint,
  'a rolled-back import contributes nothing');

select lives_ok($$select public.import_curated_collection('future-catalog','Future','book','KJV',
  current_setting('test.passages')::jsonb)$$, 'older valid imports outside the current catalog still work');
select is((select saver_count from public.get_curated_collection_saver_counts(array['future-catalog'])), 0::bigint,
  'unrecognized catalog IDs do not create public contributions');

select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select lives_ok($$select public.delete_own_account()$$, 'the real account deletion removes reader A');
select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
select is((select saver_count from public.get_curated_collection_saver_counts(array['hope'])), 2::bigint,
  'account deletion retains the all-time count');
select lives_ok($$select public.delete_own_account()$$, 'the real account deletion removes reader B');
reset role;
select is((select count(*) from public.curated_collection_savers where catalog_id='hope' and user_id is null),
  2::bigint, 'two deleted accounts retain two anonymous contributions');
select is((select count(*) from public.curated_collection_savers where user_id in (
  current_setting('test.reader_a')::uuid,current_setting('test.reader_b')::uuid)),
  0::bigint, 'deleted accounts retain no identity link');

set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select * from public.get_curated_collection_saver_counts(array['hope'])$$,
  '42501', 'Authentication required', 'the reader checks auth even through an authenticated SQL role');
select throws_ok($$select private.record_curated_collection_save('hope',gen_random_uuid())$$,
  '42501', 'Authentication required', 'the writer checks auth internally');
select * from finish();
rollback;
