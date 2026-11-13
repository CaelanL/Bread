-- The owner's "Delete for everyone" in one transaction: delete_collection on the owner's copy of a
-- shared collection deletes the group first (sync_members_before_dissolve gives every member their
-- own copy, and the foreign key makes every copy personal), then the owner's collection goes with
-- the usual rule. A failure anywhere changes nothing. A member's copy still goes through leave.
-- Old clients stop sharing first, so they reach the unchanged personal path.
-- destructive-ok: delete statements in a replaced function that applies the existing stop-sharing and collection-delete rules when an owner deletes a shared collection, no existing data deleted, approved by Caelan 2026-11-12
create or replace function public.delete_collection(collection_client_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  target public.user_collections%rowtype;
  group_id uuid;
  owns_group boolean := false;
  removed uuid[];
begin
  if owner_id is null then
    raise exception 'Sign in to delete a collection' using errcode = '42501';
  end if;

  -- The group lock before the collection lock: the order a dissolve and a join take them in.
  select c.shared_collection_id into group_id from public.user_collections as c
  where c.user_id = owner_id and c.client_id = collection_client_id and c.deleted_at is null;
  if group_id is not null then
    perform 1 from public.shared_collections as s where s.id = group_id for update;
    owns_group := exists (select 1 from public.shared_collections as s where s.id = group_id and s.owner_id = auth.uid());
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
  if target.shared_collection_id is not null then
    -- A member leaves instead. The group moving between the two reads above is a retry.
    if not owns_group or target.shared_collection_id is distinct from group_id then
      raise exception 'Stop sharing or leave this collection first' using errcode = '22023';
    end if;
    delete from public.shared_collections as s where s.id = group_id;
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
