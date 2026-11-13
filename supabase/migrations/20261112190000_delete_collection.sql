-- Deleting a collection in one transaction, with the same rule as deleteVerse and
-- private.remove_verse_from_collection: each verse leaves the collection; a verse in no other
-- collection is soft-deleted when mastered (it stays on the Mastered list) and hard-deleted
-- otherwise. Either all of it happens or none. Old clients keep their own path.
-- destructive-ok: delete statements in a new function that applies the existing collection-delete rule when a user deletes a collection, no existing data deleted, approved by Caelan 2026-11-12
create function public.delete_collection(collection_client_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  target public.user_collections%rowtype;
  removed uuid[];
begin
  if owner_id is null then
    raise exception 'Sign in to delete a collection' using errcode = '42501';
  end if;

  select * into target from public.user_collections as c
  where c.user_id = owner_id and c.client_id = collection_client_id and c.deleted_at is null
  for update;

  if not found then
    -- A retry after a lost response finds the collection already deleted.
    if exists (select 1 from public.user_collections as c
      where c.user_id = owner_id and c.client_id = collection_client_id) then
      return;
    end if;
    raise exception 'Collection not found' using errcode = '22023';
  end if;
  if target.is_default then
    raise exception 'My Verses can''t be deleted' using errcode = '22023';
  end if;
  -- A shared copy goes through stop sharing (owner) or leave (member) first.
  if target.shared_collection_id is not null then
    raise exception 'Stop sharing or leave this collection first' using errcode = '22023';
  end if;

  -- Same order as copy_verse_to_collection (collection, then verse), so the two can't deadlock,
  -- and a copy into another collection commits before the "held elsewhere" check below reads.
  perform 1 from public.user_verses as v
  where v.id in (select vc.verse_id from public.verse_collections as vc where vc.collection_id = target.id)
  order by v.id
  for update;

  with gone as (
    delete from public.verse_collections as vc where vc.collection_id = target.id returning vc.verse_id
  )
  select coalesce(array_agg(gone.verse_id), '{}') into removed from gone;

  update public.user_verses as v set deleted_at = now()
  where v.id = any(removed) and v.user_id = owner_id and v.deleted_at is null
    and coalesce(v.progress -> 'hard' -> 'completed' = 'true'::jsonb, false)
    and not exists (select 1 from public.verse_collections as vc where vc.verse_id = v.id);

  delete from public.user_verses as v
  where v.id = any(removed) and v.user_id = owner_id
    and not coalesce(v.progress -> 'hard' -> 'completed' = 'true'::jsonb, false)
    and not exists (select 1 from public.verse_collections as vc where vc.verse_id = v.id);

  update public.user_collections set deleted_at = now() where id = target.id;
end;
$$;

revoke execute on function public.delete_collection(text) from public, anon;
grant execute on function public.delete_collection(text) to authenticated;
