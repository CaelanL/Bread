-- Adding a verse to one of the user's own collections in one transaction, instead of the store's
-- up to six requests: My Verses is created on first use, an unknown or deleted collection is an
-- error (never a silent move to My Verses), the reference's held verse is reused or its best
-- removed row restored, then linked. All of it happens or none. Shared collections add through
-- the group (addSharedVerse). Old clients keep their own path. References only: no verse text.
create function public.add_verse(
  p_book text,
  p_chapter integer,
  p_verse_start integer,
  p_verse_end integer,
  p_version text,
  p_collection_client_id text,
  p_keep_restored_version boolean default false
) returns public.user_verses
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  target public.user_collections%rowtype;
  saved public.user_verses%rowtype;
begin
  if owner_id is null then
    raise exception 'Sign in to add a verse' using errcode = '42501';
  end if;
  if (
    length(p_book) between 1 and 32 and p_book ~ '^([1-3] )?[A-Za-z]+( [A-Za-z]+)*$'
    and p_chapter between 1 and 150
    and p_verse_start between 1 and 176
    and p_verse_end between p_verse_start and 176
    and p_version ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'
  ) is not true then
    raise exception 'Invalid verse' using errcode = '22023';
  end if;

  -- Same lock as import_curated_collection and sync_member_copies: all three create verses for
  -- one account, so a double tap can't make two rows for one reference.
  perform pg_advisory_xact_lock(hashtextextended('curated-collection:' || owner_id::text, 0));

  if p_collection_client_id = 'my-verses' then
    insert into public.user_collections (user_id, client_id, name, is_default, created_at)
    values (owner_id, 'my-verses', 'My Verses', true, 'epoch')
    on conflict (user_id, client_id) do nothing;
  end if;

  -- Same order as copy_verse_to_collection (collection, then verse).
  select * into target from public.user_collections as c
  where c.user_id = owner_id and c.client_id = p_collection_client_id and c.deleted_at is null
    and c.client_id not in ('mastered', 'in-progress')
  for share;
  if not found then
    raise exception 'Collection not found' using errcode = '22023';
  end if;
  if target.shared_collection_id is not null then
    raise exception 'Add verses to a shared collection through the group' using errcode = '22023';
  end if;

  -- One verse per reference, in any translation. A held verse is reused; otherwise the best
  -- removed row comes back, ranked as compareRecords in lib/store/translation.ts.
  select * into saved from public.user_verses as v
  where v.user_id = owner_id and v.book = p_book and v.chapter = p_chapter
    and v.verse_start = p_verse_start and v.verse_end = p_verse_end
  order by
    v.deleted_at is null desc,
    ((v.progress #>> '{hard,completed}') = 'true') is true desc,
    coalesce((v.progress #>> '{engraved,passCount}')::numeric, 0) desc,
    ((v.progress #>> '{easy,completed}') = 'true' is true)::int
      + ((v.progress #>> '{medium,completed}') = 'true' is true)::int
      + ((v.progress #>> '{hard,completed}') = 'true' is true)::int desc,
    v.version = p_version desc,
    v.id
  limit 1
  for update;

  if not found then
    insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version)
    values (owner_id, 'verse-' || gen_random_uuid(), p_book, p_chapter, p_verse_start, p_verse_end, p_version)
    returning * into saved;
  elsif saved.deleted_at is not null then
    -- A restored verse comes back in the account translation, unless the client says that
    -- translation may leave the verse out, or another row of the reference already has it.
    update public.user_verses as v
    set deleted_at = null,
      version = case
        when p_keep_restored_version or exists (select 1 from public.user_verses as o
          where o.user_id = owner_id and o.id <> saved.id and o.book = p_book and o.chapter = p_chapter
            and o.verse_start = p_verse_start and o.verse_end = p_verse_end and o.version = p_version)
        then saved.version else p_version end
    where v.id = saved.id
    returning * into saved;
  end if;

  insert into public.verse_collections (verse_id, collection_id)
  values (saved.id, target.id)
  on conflict (verse_id, collection_id) do nothing;

  return saved;
end;
$$;

revoke execute on function public.add_verse(text, integer, integer, integer, text, text, boolean) from public, anon;
grant execute on function public.add_verse(text, integer, integer, integer, text, text, boolean) to authenticated;
