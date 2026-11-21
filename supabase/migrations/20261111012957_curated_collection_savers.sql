create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.curated_collection_savers (
  id bigint generated always as identity primary key,
  catalog_id text not null,
  user_id uuid references auth.users(id) on delete set null,
  unique (catalog_id, user_id)
);
create index curated_collection_savers_user_idx
  on public.curated_collection_savers (user_id) where user_id is not null;
alter table public.curated_collection_savers enable row level security;
revoke all on public.curated_collection_savers from public, anon, authenticated;
revoke all on sequence public.curated_collection_savers_id_seq from public, anon, authenticated;

create function private.curated_catalog_ids() returns text[]
language sql immutable security invoker set search_path = ''
as $$
  select array[
    'anxiety-and-peace', 'hope', 'salvation', 'the-nations', 'spiritual-warfare',
    'trusting-god', 'prayer', 'gods-love', 'wisdom', 'gratitude-and-joy'
  ]::text[];
$$;
revoke all on function private.curated_catalog_ids() from public, anon, authenticated;

create function private.record_curated_collection_save(p_catalog_id text, p_collection_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  -- Older callers may import other valid catalog IDs; only shipped catalog entries have public totals.
  if p_catalog_id is null or not p_catalog_id = any(private.curated_catalog_ids()) then
    return;
  end if;
  if not exists (
    select 1 from public.user_collections
    where id = p_collection_id and user_id = owner_id
      and not is_default and deleted_at is null
      and client_id ~ ('^curated-' || p_catalog_id || '-[A-Z0-9][A-Z0-9-]{1,15}$')
  ) then
    raise exception 'Collection does not belong to this import' using errcode = '42501';
  end if;
  insert into public.curated_collection_savers (catalog_id, user_id)
  values (p_catalog_id, owner_id)
  on conflict (catalog_id, user_id) do nothing;
end;
$$;
revoke all on function private.record_curated_collection_save(text, uuid) from public, anon;
grant execute on function private.record_curated_collection_save(text, uuid) to authenticated;

create function private.read_curated_collection_savers(p_catalog_ids text[])
returns table (catalog_id text, saver_count bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if array_ndims(p_catalog_ids) is distinct from 1
    or cardinality(p_catalog_ids) not between 1 and 50
    or exists (select 1 from unnest(p_catalog_ids) id
      where id is null or length(id) > 48 or id !~ '^[a-z]+(-[a-z]+)*$') then
    raise exception 'Invalid catalog IDs' using errcode = '22023';
  end if;
  return query
    select requested.id, count(s.id)
    from (select distinct unnest(p_catalog_ids) as id) requested
    left join public.curated_collection_savers s on s.catalog_id = requested.id
    group by requested.id;
end;
$$;
revoke all on function private.read_curated_collection_savers(text[]) from public, anon;
grant execute on function private.read_curated_collection_savers(text[]) to authenticated;

create function public.get_curated_collection_saver_counts(p_catalog_ids text[])
returns table (catalog_id text, saver_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select * from private.read_curated_collection_savers(p_catalog_ids);
$$;
revoke all on function public.get_curated_collection_saver_counts(text[]) from public, anon;
grant execute on function public.get_curated_collection_saver_counts(text[]) to authenticated;

-- The deterministic import identity survives renames, content edits and soft deletion.
insert into public.curated_collection_savers (catalog_id, user_id)
select distinct catalog.id, c.user_id
from public.user_collections c
cross join unnest(private.curated_catalog_ids()) catalog(id)
where not c.is_default
  and c.client_id ~ ('^curated-' || catalog.id || '-[A-Z0-9][A-Z0-9-]{1,15}$')
on conflict (catalog_id, user_id) do nothing;

create or replace function public.import_curated_collection(
  p_catalog_id text,
  p_name text,
  p_icon_key text,
  p_version text,
  p_passages jsonb
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  collection_client_id text := 'curated-' || p_catalog_id || '-' || p_version;
  saved_collection public.user_collections%rowtype;
  saved_verse public.user_verses%rowtype;
  passage record;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if (
    p_catalog_id ~ '^[a-z]+(-[a-z]+)*$' and length(p_catalog_id) <= 48
    and length(p_name) between 1 and 80 and btrim(p_name) <> ''
    and p_icon_key ~ '^[a-z]+(-[a-z]+)*$' and length(p_icon_key) <= 48
    and p_version ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'
  ) is not true or jsonb_typeof(p_passages) is distinct from 'array' then
    raise exception 'Invalid collection' using errcode = '22023';
  end if;

  if jsonb_array_length(p_passages) not between 1 and 15 or octet_length(p_passages::text) > 4096 or (
    select count(*) = count(distinct (r.book, r.chapter, r.verse_start, r.verse_end))
      and bool_and((
        length(r.book) between 1 and 32
        and r.book ~ '^([1-3] )?[A-Za-z]+( [A-Za-z]+)*$'
        and r.chapter between 1 and 150
        and r.verse_start between 1 and 176
        and r.verse_end between r.verse_start and least(r.verse_start + 1, 176)
      ) is true)
    from jsonb_to_recordset(p_passages) as r(book text, chapter integer, verse_start integer, verse_end integer)
  ) is not true then
    raise exception 'Invalid or duplicate passages' using errcode = '22023';
  end if;

  -- Serialize imports for an account, including different collections with overlapping passages.
  perform pg_advisory_xact_lock(hashtextextended('curated-collection:' || owner_id::text, 0));

  select * into saved_collection
  from public.user_collections
  where user_id = owner_id and client_id = collection_client_id
  for update;

  if found then
    if saved_collection.is_default then
      raise exception 'Cannot import into a protected collection' using errcode = '22023';
    end if;
    if saved_collection.deleted_at is null then
      perform private.record_curated_collection_save(p_catalog_id, saved_collection.id);
      return saved_collection.id;
    end if;

    update public.user_collections
    set deleted_at = null, name = p_name, icon_key = p_icon_key, position = null, created_at = now()
    where id = saved_collection.id and user_id = owner_id;
  else
    insert into public.user_collections (user_id, client_id, name, icon_key)
    values (owner_id, collection_client_id, p_name, p_icon_key)
    returning * into saved_collection;
  end if;

  for passage in
    select * from jsonb_to_recordset(p_passages)
      as r(book text, chapter integer, verse_start integer, verse_end integer)
  loop
    select * into saved_verse
    from public.user_verses
    where user_id = owner_id
      and book = passage.book and chapter = passage.chapter
      and verse_start = passage.verse_start and verse_end = passage.verse_end
      and version = p_version
    order by deleted_at desc nulls first, created_at desc, id
    limit 1
    for update;

    if not found then
      insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version)
      values (owner_id, 'verse-' || gen_random_uuid(), passage.book, passage.chapter,
        passage.verse_start, passage.verse_end, p_version)
      returning * into saved_verse;
    elsif saved_verse.deleted_at is not null then
      update public.user_verses set deleted_at = null
      where id = saved_verse.id and user_id = owner_id;
    end if;

    insert into public.verse_collections (verse_id, collection_id)
    values (saved_verse.id, saved_collection.id)
    on conflict (verse_id, collection_id) do nothing;
  end loop;

  perform private.record_curated_collection_save(p_catalog_id, saved_collection.id);
  return saved_collection.id;
end;
$$;
