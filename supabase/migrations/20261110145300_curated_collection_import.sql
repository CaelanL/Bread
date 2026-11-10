alter table public.user_collections add column icon_key text;

-- The original list predates the NIV, NKJV and KJV options in the app.
alter table public.user_verses
  drop constraint if exists user_verses_version_check,
  add constraint user_verses_version_check
    check (version ~ '^[A-Z0-9][A-Z0-9-]{1,15}$') not valid;

create function public.import_curated_collection(
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
      return saved_collection.id;
    end if;

    update public.user_collections
    set deleted_at = null, name = p_name, icon_key = p_icon_key, created_at = now()
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

  return saved_collection.id;
end;
$$;

revoke execute on function public.import_curated_collection(text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.import_curated_collection(text, text, text, text, jsonb)
  to authenticated;
