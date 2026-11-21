-- Removing one verse from a collection in one transaction, with the same rule as
-- private.remove_verse_from_collection (which clients can't execute): the verse leaves the
-- collection; a verse in no other collection is soft-deleted when mastered (it stays on the
-- Mastered list) and hard-deleted otherwise. Either all of it happens or none. Old clients keep
-- their own path.
-- destructive-ok: delete statements in a new function that applies the existing verse-delete rule when a user removes a verse from a collection, no existing data deleted, approved by Caelan 2026-11-12
create function public.delete_verse(verse_client_id text, collection_client_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  target public.user_collections%rowtype;
  verse public.user_verses%rowtype;
begin
  if owner_id is null then
    raise exception 'Sign in to delete a verse' using errcode = '42501';
  end if;

  -- Same order as copy_verse_to_collection (collection, then verse), so the two can't deadlock,
  -- and a copy into another collection commits before the "held elsewhere" check below reads.
  select * into target from public.user_collections as c
  where c.user_id = owner_id and c.client_id = collection_client_id
  for share;

  if not found then
    raise exception 'Collection not found' using errcode = '22023';
  end if;
  -- A shared copy changes through the group's reference list.
  if target.shared_collection_id is not null then
    raise exception 'Remove this verse from the shared collection instead' using errcode = '22023';
  end if;

  select * into verse from public.user_verses as v
  where v.user_id = owner_id and v.client_id = verse_client_id
  for update;

  -- A retry after a lost response finds the verse deleted, or no longer in this collection.
  if not found then
    return;
  end if;
  delete from public.verse_collections as vc where vc.verse_id = verse.id and vc.collection_id = target.id;
  if not found then
    return;
  end if;

  if exists (select 1 from public.verse_collections as vc where vc.verse_id = verse.id) then
    return;
  end if;
  if coalesce(verse.progress -> 'hard' -> 'completed' = 'true'::jsonb, false) then
    update public.user_verses as v set deleted_at = now() where v.id = verse.id and v.deleted_at is null;
  else
    delete from public.user_verses as v where v.id = verse.id;
  end if;
end;
$$;

revoke execute on function public.delete_verse(text, text) from public, anon;
grant execute on function public.delete_verse(text, text) to authenticated;
