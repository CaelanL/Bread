-- Old app versions delete a collection's verses from the client: a verse whose "other
-- collections" count failed to read counted as in none, and was hard-deleted while it was still
-- in other collections. This refuses a client's delete of a verse that still has a collection
-- link no other row of the same reference holds. Old apps ignore the error, so the verse stays.
-- Every current delete removes the links first (delete_collection, delete_verse, the shared
-- removal, delete_own_account), and collapseVerse moves the links onto a same-reference twin
-- first, so those still pass; cascades (deleting the auth user) run at trigger depth 2 and skip
-- the check (docs/architecture/bible-versions.md). Additive: no client loses a working delete.
create function private.guard_verse_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Clients only: cascades and other triggers run deeper, and server-side roles are trusted.
  if pg_trigger_depth() > 1 or current_user not in ('authenticated', 'anon') then
    return old;
  end if;
  if exists (
    select 1
    from public.verse_collections as link
    where link.verse_id = old.id
      and not exists (
        select 1
        from public.verse_collections as held
        join public.user_verses as twin on twin.id = held.verse_id
        where held.collection_id = link.collection_id
          and twin.id <> old.id
          and twin.user_id = old.user_id
          and twin.book = old.book
          and twin.chapter = old.chapter
          and twin.verse_start = old.verse_start
          and twin.verse_end = old.verse_end
      )
  ) then
    raise exception 'This verse is still in a collection';
  end if;
  return old;
end;
$$;

revoke execute on function private.guard_verse_delete() from public, anon, authenticated;

create trigger guard_verse_delete
before delete on public.user_verses
for each row execute function private.guard_verse_delete();
