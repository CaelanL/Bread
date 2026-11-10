begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

select ok(
  not has_function_privilege('anon', 'public.import_curated_collection(text,text,text,text,jsonb)', 'EXECUTE'),
  'anon cannot import curated collections'
);
select ok(
  has_function_privilege('authenticated', 'public.import_curated_collection(text,text,text,text,jsonb)', 'EXECUTE'),
  'authenticated clients can import'
);

select set_config('test.reader_a', (select id::text from auth.users where email = 'reader-a@example.test'), true);
select set_config('test.reader_b', (select id::text from auth.users where email = 'reader-b@example.test'), true);
select set_config('test.seed_verse_id', (select id::text from public.user_verses where client_id = 'seed-john-3-16'), true);
select set_config('test.passages', '[
  {"book":"John","chapter":3,"verse_start":16,"verse_end":16},
  {"book":"Ephesians","chapter":2,"verse_start":8,"verse_end":9}
]', true);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);

insert into public.user_collections (user_id, client_id, name)
values (auth.uid(), 'old-client-collection', 'Old collection');
update public.user_collections set name = 'Old client rename' where client_id = 'old-client-collection';
select ok(
  exists(select 1 from public.user_collections
    where client_id = 'old-client-collection' and name = 'Old client rename' and icon_key is null),
  'old client insert and rename leave the icon nullable'
);

update public.user_verses set last_chunk_size = 8, last_difficulty = 'hard'
where client_id = 'seed-john-3-16';

select set_config('test.seed_snapshot', (
  select to_jsonb(v)::text from public.user_verses v where client_id = 'seed-john-3-16'
), true);
select set_config('test.attempts', (
  select count(*)::text from public.session_attempts
), true);
select set_config('test.import_id', public.import_curated_collection(
  'salvation', 'Salvation', 'cross', 'ESV', current_setting('test.passages')::jsonb
)::text, true);

select is(
  (select icon_key from public.user_collections where id = current_setting('test.import_id')::uuid),
  'cross',
  'import sets the chosen icon'
);
select is(
  (select count(*)::int from public.verse_collections where collection_id = current_setting('test.import_id')::uuid),
  2,
  'import saves every passage to the new collection'
);
select is(
  (select count(*)::int from public.verse_collections where verse_id = current_setting('test.seed_verse_id')::uuid),
  2,
  'import shares the original verse identity with My Verses'
);
select is(
  (select to_jsonb(v) from public.user_verses v where client_id = 'seed-john-3-16'),
  current_setting('test.seed_snapshot')::jsonb,
  'import preserves the entire existing verse including progress and study preferences'
);
select is(
  (select count(*) from public.session_attempts),
  current_setting('test.attempts')::bigint,
  'import preserves session history'
);
select is(
  (select progress->'hard'->>'completed' from public.user_verses
   where book = 'Ephesians' and chapter = 2 and verse_start = 8 and version = 'ESV'),
  'false',
  'a genuinely new verse starts with uncompleted progress'
);

update public.user_collections set name = 'My edited copy', icon_key = 'heart'
where id = current_setting('test.import_id')::uuid;
delete from public.verse_collections where collection_id = current_setting('test.import_id')::uuid
  and verse_id <> current_setting('test.seed_verse_id')::uuid;

select is(public.import_curated_collection(
  'salvation', 'Changed catalog title', 'star', 'ESV', current_setting('test.passages')::jsonb
)::text, current_setting('test.import_id'), 'retry returns the same collection');
select is(
  (select concat(name, ':', icon_key) from public.user_collections where id = current_setting('test.import_id')::uuid),
  'My edited copy:heart',
  'retry preserves custom name and icon'
);
select is(
  (select count(*)::int from public.verse_collections where collection_id = current_setting('test.import_id')::uuid),
  1,
  'retry preserves a removed membership'
);

select set_config('test.kjv_import_id', public.import_curated_collection(
  'salvation', 'Salvation', 'cross', 'KJV', current_setting('test.passages')::jsonb
)::text, true);
select isnt(current_setting('test.kjv_import_id'), current_setting('test.import_id'),
  'a different version creates a separate collection');
select results_eq(
  $$select v.version from public.user_verses v join public.verse_collections vc on v.id = vc.verse_id
    where vc.collection_id = current_setting('test.kjv_import_id')::uuid$$,
  $$values ('KJV'::text), ('KJV'::text)$$,
  'all new collection passages use the chosen version'
);
select lives_ok($$select public.import_curated_collection(
  'salvation', 'Salvation', 'cross', 'NIV', current_setting('test.passages')::jsonb
)$$, 'NIV imports work on the replayed schema');
select lives_ok($$select public.import_curated_collection(
  'salvation', 'Salvation', 'cross', 'NKJV', current_setting('test.passages')::jsonb
)$$, 'NKJV imports work on the replayed schema');

-- Model the state after a user explicitly deletes an imported collection.
delete from public.verse_collections where collection_id = current_setting('test.import_id')::uuid;
update public.user_collections set deleted_at = now() where id = current_setting('test.import_id')::uuid;
update public.user_verses set deleted_at = now() where id = current_setting('test.seed_verse_id')::uuid;
select is(public.import_curated_collection(
  'salvation', 'Salvation', 'cross', 'ESV', current_setting('test.passages')::jsonb
)::text, current_setting('test.import_id'), 'explicit re-add restores the deleted collection');
select is(
  (select count(*)::int from public.verse_collections where collection_id = current_setting('test.import_id')::uuid),
  2,
  'explicit re-add restores both memberships'
);
select is(
  (select to_jsonb(v) - 'updated_at' from public.user_verses v
    where id = current_setting('test.seed_verse_id')::uuid and deleted_at is null),
  current_setting('test.seed_snapshot')::jsonb - 'updated_at',
  'explicit re-add restores soft-deleted verse without changing progress or preferences'
);

select throws_ok($$select public.import_curated_collection(
  'bad-range', 'Bad range', 'book', 'ESV',
  '[{"book":"John","chapter":8,"verse_start":1,"verse_end":1},
    {"book":"John","chapter":8,"verse_start":2,"verse_end":4}]'
)$$, '22023', 'Invalid or duplicate passages', 'a later invalid range aborts the whole import');
select throws_ok($$select public.import_curated_collection(
  'duplicate', 'Duplicate', 'book', 'ESV',
  '[{"book":"John","chapter":8,"verse_start":1,"verse_end":1},
    {"book":"John","chapter":8,"verse_start":1,"verse_end":1}]'
)$$, '22023', 'Invalid or duplicate passages', 'duplicate input references are rejected');
select throws_ok($$select public.import_curated_collection(
  'too-many', 'Too many', 'book', 'ESV',
  (select jsonb_agg(jsonb_build_object('book','John','chapter',1,'verse_start',n,'verse_end',n))
   from generate_series(1,16) n)
)$$, '22023', 'Invalid or duplicate passages', 'oversized imports are rejected');

insert into public.user_collections (user_id, client_id, name, is_default)
values (auth.uid(), 'curated-protected-ESV', 'Protected', true);
select throws_ok($$select public.import_curated_collection(
  'protected', 'Overwrite', 'book', 'ESV', current_setting('test.passages')::jsonb
)$$, '22023', 'Cannot import into a protected collection', 'an import cannot restore or rewrite a default collection');

-- Fail a valid later insert after the collection and first membership have been written.
reset role;
create function pg_temp.reject_import_test_verse() returns trigger language plpgsql as $$
begin
  if new.book = 'John' and new.chapter = 21 and new.verse_start = 25 then
    raise exception 'Fixture rejected';
  end if;
  return new;
end;
$$;
create trigger reject_import_test_verse before insert on public.user_verses
for each row execute function pg_temp.reject_import_test_verse();

set local role authenticated;
select throws_ok($$select public.import_curated_collection(
  'rollback', 'Rollback', 'book', 'ESV',
  '[{"book":"John","chapter":21,"verse_start":24,"verse_end":24},
    {"book":"John","chapter":21,"verse_start":25,"verse_end":25}]'
)$$, 'P0001', 'Fixture rejected', 'a failed later write aborts the transaction');
select is(
  (select count(*)::int from public.user_collections where client_id in ('curated-bad-range-ESV', 'curated-rollback-ESV')),
  0, 'failure leaves no partially imported collection'
);
select is(
  (select count(*)::int from public.user_verses where book = 'John' and chapter in (8, 21)),
  0, 'failure rolls back earlier verse and membership inserts'
);

select set_config('request.jwt.claim.sub', current_setting('test.reader_b'), true);
with changed as (
  update public.user_collections set icon_key = 'star' where id = current_setting('test.import_id')::uuid returning id
)
select is((select count(*)::int from changed), 0, 'reader B cannot change reader A’s icon');
select isnt(public.import_curated_collection(
  'salvation', 'Salvation', 'cross', 'ESV', current_setting('test.passages')::jsonb
)::text, current_setting('test.import_id'), 'reader B gets their own collection for the same catalog and version');
select is(
  (select count(*)::int from public.verse_collections where verse_id = current_setting('test.seed_verse_id')::uuid),
  0, 'reader B cannot reuse reader A’s verse identity'
);

select set_config('request.jwt.claim.sub', current_setting('test.reader_a'), true);
select is(
  (select icon_key from public.user_collections where id = current_setting('test.import_id')::uuid),
  'cross', 'reader A’s icon is unchanged by reader B'
);

select * from finish();
rollback;
