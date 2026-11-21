alter table public.user_collections add column position integer;

create function public.reorder_collections(collection_ids text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  active_ids text[];
  requested_ids text[];
begin
  if owner_id is null then
    raise exception 'Sign in to reorder collections' using errcode = '42501';
  end if;

  select array(select input.id from unnest(collection_ids) as input(id) order by input.id)
    into requested_ids;

  -- Lock in the same order for every request so overlapping saves serialize.
  select array(
    select locked.client_id
    from (
      select c.client_id
      from public.user_collections as c
      where c.user_id = owner_id and c.deleted_at is null and not c.is_default
        and c.client_id not in ('my-verses', 'mastered', 'in-progress')
      order by c.id
      for no key update
    ) as locked
    order by locked.client_id
  ) into active_ids;

  if collection_ids is null or requested_ids <> active_ids then
    raise exception 'Collection list changed. Refresh and try again.' using errcode = '22023';
  end if;

  update public.user_collections as c
  set position = requested.ordinality::integer
  from unnest(collection_ids) with ordinality as requested(id, ordinality)
  where c.user_id = owner_id and c.client_id = requested.id
    and c.deleted_at is null and not c.is_default
    and c.position is distinct from requested.ordinality::integer;
end;
$$;

create function public.copy_verse_to_collection(verse_client_id text, collection_client_id text)
returns setof public.verse_collections
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  source_id uuid;
  source_deleted_at timestamptz;
  target_id uuid;
begin
  if owner_id is null then
    raise exception 'Sign in to copy a verse' using errcode = '42501';
  end if;

  if collection_client_id = 'my-verses' then
    insert into public.user_collections (user_id, client_id, name, is_default, created_at)
    values (owner_id, 'my-verses', 'My Verses', true, 'epoch')
    on conflict (user_id, client_id) do nothing;
  end if;

  select c.id into target_id
  from public.user_collections as c
  where c.user_id = owner_id and c.client_id = collection_client_id
    and c.deleted_at is null and c.client_id not in ('mastered', 'in-progress')
    and c.is_default = (collection_client_id = 'my-verses')
  for share;

  if target_id is null then
    raise exception 'Collection not found' using errcode = '22023';
  end if;

  select v.id, v.deleted_at into source_id, source_deleted_at
  from public.user_verses as v
  where v.user_id = owner_id and v.client_id = verse_client_id
  for no key update;

  if source_id is null then
    raise exception 'Verse not found' using errcode = '22023';
  end if;

  if source_deleted_at is not null then
    update public.user_verses as v set deleted_at = null where v.id = source_id;
  end if;

  insert into public.verse_collections (verse_id, collection_id)
  values (source_id, target_id)
  on conflict (verse_id, collection_id) do nothing;

  return query
  select vc.* from public.verse_collections as vc
  where vc.verse_id = source_id and vc.collection_id = target_id;
end;
$$;

revoke execute on function public.reorder_collections(text[]) from public, anon;
revoke execute on function public.copy_verse_to_collection(text, text) from public, anon;
grant execute on function public.reorder_collections(text[]) to authenticated;
grant execute on function public.copy_verse_to_collection(text, text) to authenticated;
