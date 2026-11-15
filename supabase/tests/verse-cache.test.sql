begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select has_column('public', 'verse_cache', 'text_rev', 'verse_cache records the text revision');
select col_is_null('public', 'verse_cache', 'text_rev', 'text_rev is nullable, so the old bible function still writes');
select ok(not has_table_privilege('anon', 'public.verse_cache', 'SELECT'), 'anonymous API calls cannot read the cache');
select ok(not has_table_privilege('authenticated', 'public.verse_cache', 'SELECT'), 'signed-in clients cannot read the cache');

select * from finish();
rollback;
