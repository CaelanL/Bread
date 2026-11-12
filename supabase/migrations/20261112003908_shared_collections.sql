-- Shared collections: a group record (references only, never verse text) plus one ordinary
-- user_collections row per member, linked by shared_collection_id. Old clients see a normal
-- collection. Reference: docs/features/shared-collections.md.
-- The delete statements below act only on the caller's own copies, or on a removed member's
-- copies and a removed reference's copies with today's remove-from-collection rule.

alter table public.profiles add column display_name text
  check (display_name is null or length(btrim(display_name)) between 1 and 40);

-- Caps, mirrored by lib/shared/constants.ts: members per group, shared collections per
-- person, invite lifetime, references per group.
create function private.shared_limits(out members integer, out collections integer, out invite_ttl interval,
  out verses integer)
language sql immutable security invoker set search_path = ''
as $$ select 30, 20, interval '14 days', 200 $$;

create function private.new_invite_code() returns text
language sql volatile security invoker set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(b.bytes, i) % 32, 1), '' order by i)
  from (select extensions.gen_random_bytes(8) as bytes) b, generate_series(0, 7) as i;
$$;

-- ---------- Tables

create table public.shared_collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80 and btrim(name) <> ''),
  icon_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shared_collections_owner_idx on public.shared_collections (owner_id);

create table public.shared_collection_members (
  shared_collection_id uuid not null references public.shared_collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'member')),
  joined_at timestamptz not null default now(),
  primary key (shared_collection_id, user_id)
);
create index shared_collection_members_user_idx on public.shared_collection_members (user_id);
create unique index shared_collection_members_one_owner
  on public.shared_collection_members (shared_collection_id) where role = 'owner';

create table public.shared_collection_verses (
  shared_collection_id uuid not null references public.shared_collections(id) on delete cascade,
  -- Canonical names, the same list as BIBLE_BOOKS in lib/bible/books.ts (lib/shared/books.test.ts checks).
  book text not null constraint shared_collection_verses_book_check check (book in (
    'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth',
    '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah',
    'Esther', 'Job', 'Psalms', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah',
    'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah',
    'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew',
    'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians',
    'Ephesians', 'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus',
    'Philemon', 'Hebrews', 'James', '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
    'Jude', 'Revelation')),
  chapter integer not null check (chapter between 1 and 150),
  verse_start integer not null check (verse_start between 1 and 176),
  verse_end integer not null,
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (shared_collection_id, book, chapter, verse_start, verse_end),
  check (verse_end between verse_start and 176)
);
create index shared_collection_verses_added_by_idx on public.shared_collection_verses (added_by);

create table public.shared_invites (
  id uuid primary key default gen_random_uuid(),
  shared_collection_id uuid not null references public.shared_collections(id) on delete cascade,
  code text not null unique default private.new_invite_code() check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + (private.shared_limits()).invite_ttl,
  revoked_at timestamptz
);
create index shared_invites_shared_idx on public.shared_invites (shared_collection_id);

-- Deleting the group turns every member's copy into a personal collection.
alter table public.user_collections add column shared_collection_id uuid
  references public.shared_collections(id) on delete set null;
create index idx_user_collections_shared on public.user_collections (shared_collection_id)
  where shared_collection_id is not null;

-- Only the definer functions link a collection to a group: clients keep every other column.
revoke insert, update on public.user_collections from anon, authenticated;
grant insert (id, user_id, client_id, name, is_default, deleted_at, created_at, updated_at,
  sort_preference, position, icon_key) on public.user_collections to anon, authenticated;
grant update (id, user_id, client_id, name, is_default, deleted_at, created_at, updated_at,
  sort_preference, position, icon_key) on public.user_collections to anon, authenticated;

create trigger update_shared_collections_updated_at
  before update on public.shared_collections
  for each row execute function public.update_updated_at_column();

-- ---------- Access

-- Definer so policies on the members table can ask about membership without recursing.
create function private.is_member(p_shared uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.shared_collection_members
    where shared_collection_id = p_shared and user_id = (select auth.uid()));
$$;

create function private.can_edit(p_shared uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.shared_collection_members
    where shared_collection_id = p_shared and user_id = (select auth.uid()) and role in ('owner', 'editor'));
$$;

alter table public.shared_collections enable row level security;
alter table public.shared_collection_members enable row level security;
alter table public.shared_collection_verses enable row level security;
alter table public.shared_invites enable row level security;

-- Column grants: an owner renames the group and sets roles, never moves rows between users or groups.
revoke all on public.shared_collections, public.shared_collection_members,
  public.shared_collection_verses, public.shared_invites from anon, authenticated;
grant select, delete on public.shared_collections to authenticated;
grant update (name, icon_key) on public.shared_collections to authenticated;
grant select on public.shared_collection_members to authenticated;
grant update (role) on public.shared_collection_members to authenticated;
grant select, insert, delete on public.shared_collection_verses to authenticated;
grant select on public.shared_invites to authenticated;

create policy "Members read their groups" on public.shared_collections
  for select to authenticated using (private.is_member(id));
create policy "Owners rename their groups" on public.shared_collections
  for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete their groups" on public.shared_collections
  for delete to authenticated using (owner_id = (select auth.uid()));

create policy "Members read their groups' members" on public.shared_collection_members
  for select to authenticated using (private.is_member(shared_collection_id));
create policy "Owners set member roles" on public.shared_collection_members
  for update to authenticated
  using (role <> 'owner' and exists (select 1 from public.shared_collections s
    where s.id = shared_collection_id and s.owner_id = (select auth.uid())))
  with check (role in ('editor', 'member') and exists (select 1 from public.shared_collections s
    where s.id = shared_collection_id and s.owner_id = (select auth.uid())));

create policy "Members read their groups' verses" on public.shared_collection_verses
  for select to authenticated using (private.is_member(shared_collection_id));
create policy "Editors add verses" on public.shared_collection_verses
  for insert to authenticated
  with check (private.can_edit(shared_collection_id) and added_by = (select auth.uid()));
create policy "Editors remove verses" on public.shared_collection_verses
  for delete to authenticated using (private.can_edit(shared_collection_id));

create policy "Owners read invites" on public.shared_invites
  for select to authenticated using (exists (select 1 from public.shared_collections s
    where s.id = shared_collection_id and s.owner_id = (select auth.uid())));

-- ---------- Helpers that write for the user they're given. Called only from the definer
-- functions and triggers below; clients can't execute them.

-- SQL twin of deleteVerse in lib/store/index.ts: drop the link; a verse in no collection
-- is soft-deleted when mastered and hard-deleted otherwise.
create function private.remove_verse_from_collection(p_user uuid, p_verse uuid, p_collection uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  mastered boolean;
begin
  delete from public.verse_collections where verse_id = p_verse and collection_id = p_collection;
  if exists (select 1 from public.verse_collections where verse_id = p_verse) then
    return;
  end if;
  select coalesce(v.progress -> 'hard' -> 'completed' = 'true'::jsonb, false) into mastered
  from public.user_verses v where v.id = p_verse and v.user_id = p_user;
  if not found then
    return;
  end if;
  if mastered then
    update public.user_verses set deleted_at = now()
    where id = p_verse and user_id = p_user and deleted_at is null;
  else
    delete from public.user_verses where id = p_verse and user_id = p_user;
  end if;
end;
$$;

-- Makes the user's local collection match the group: restores and renames the local row,
-- adds a copy of each reference (reusing a held row, else a new one in p_version) and
-- removes copies whose reference left the group. Returns the local client_id, and whether
-- it wrote anything (so the client refetches only then).
create function private.sync_member_copies(p_user uuid, p_shared uuid, p_version text,
  out local_client_id text, out changed boolean)
language plpgsql security invoker set search_path = ''
as $$
declare
  grp public.shared_collections%rowtype;
  local_row public.user_collections%rowtype;
  ref record;
  held public.user_verses%rowtype;
  stale record;
  linked integer;
  my_verses_id uuid;
begin
  changed := false;
  if p_version is null or p_version !~ '^[A-Z0-9][A-Z0-9-]{1,15}$' then
    raise exception 'Invalid translation' using errcode = '22023';
  end if;
  select * into grp from public.shared_collections where id = p_shared;
  if not found then
    raise exception 'Shared collection not found' using errcode = '22023';
  end if;

  -- Same lock as import_curated_collection: both create verses for one account.
  perform pg_advisory_xact_lock(hashtextextended('curated-collection:' || p_user::text, 0));

  select * into local_row from public.user_collections
  where user_id = p_user and shared_collection_id = p_shared
  order by deleted_at desc nulls first, created_at
  limit 1
  for update;

  if not found then
    insert into public.user_collections (user_id, client_id, name, icon_key, shared_collection_id)
    values (p_user, 'shared-' || p_shared, grp.name, grp.icon_key, p_shared)
    returning * into local_row;
    changed := true;
  elsif local_row.deleted_at is not null
    or local_row.name is distinct from grp.name
    or local_row.icon_key is distinct from grp.icon_key then
    update public.user_collections
    set deleted_at = null, name = grp.name, icon_key = grp.icon_key
    where id = local_row.id;
    changed := true;
  end if;

  for ref in
    select r.book, r.chapter, r.verse_start, r.verse_end
    from public.shared_collection_verses r where r.shared_collection_id = p_shared
  loop
    select * into held from public.user_verses v
    where v.user_id = p_user and v.book = ref.book and v.chapter = ref.chapter
      and v.verse_start = ref.verse_start and v.verse_end = ref.verse_end
    order by v.deleted_at desc nulls first, (v.version = p_version) desc, v.created_at desc, v.id
    limit 1
    for update;

    if not found then
      insert into public.user_verses (user_id, client_id, book, chapter, verse_start, verse_end, version)
      values (p_user, 'verse-' || gen_random_uuid(), ref.book, ref.chapter, ref.verse_start, ref.verse_end, p_version)
      returning * into held;
      changed := true;
    elsif held.deleted_at is not null then
      update public.user_verses set deleted_at = null where id = held.id;
      changed := true;
    end if;

    insert into public.verse_collections (verse_id, collection_id)
    values (held.id, local_row.id)
    on conflict (verse_id, collection_id) do nothing;
    get diagnostics linked = row_count;
    changed := changed or linked > 0;
  end loop;

  -- A verse that isn't a group reference (an old client added it to the copy) moves to
  -- My Verses with its progress. Removed references already left every copy (trigger below).
  for stale in
    select vc.verse_id from public.verse_collections vc
    join public.user_verses v on v.id = vc.verse_id
    where vc.collection_id = local_row.id
      and not exists (select 1 from public.shared_collection_verses r
        where r.shared_collection_id = p_shared and r.book = v.book and r.chapter = v.chapter
          and r.verse_start = v.verse_start and r.verse_end = v.verse_end)
  loop
    if my_verses_id is null then
      insert into public.user_collections (user_id, client_id, name, is_default, created_at)
      values (p_user, 'my-verses', 'My Verses', true, 'epoch')
      on conflict (user_id, client_id) do update set deleted_at = null
      returning id into my_verses_id;
    end if;
    delete from public.verse_collections where verse_id = stale.verse_id and collection_id = local_row.id;
    insert into public.verse_collections (verse_id, collection_id)
    values (stale.verse_id, my_verses_id)
    on conflict (verse_id, collection_id) do nothing;
    changed := true;
  end loop;

  local_client_id := local_row.client_id;
end;
$$;

-- Leave and remove: the membership goes, then the local collection with today's delete rule.
create function private.drop_member_collection(p_user uuid, p_shared uuid)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  local_row record;
  link record;
begin
  delete from public.shared_collection_members
  where shared_collection_id = p_shared and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'Not a member' using errcode = '42501';
  end if;

  for local_row in
    select id from public.user_collections
    where user_id = p_user and shared_collection_id = p_shared and deleted_at is null
  loop
    for link in select verse_id from public.verse_collections where collection_id = local_row.id loop
      perform private.remove_verse_from_collection(p_user, link.verse_id, local_row.id);
    end loop;
    update public.user_collections set deleted_at = now() where id = local_row.id;
  end loop;
end;
$$;

-- One row per member and shared reference they hold a verse for (any translation, removed
-- copies included: mastery is permanent). Booleans only, never a member's progress itself.
create function private.member_squares(p_shared uuid)
returns table (user_id uuid, book text, chapter integer, verse_start integer, verse_end integer,
  practiced boolean, mastered boolean, engraved boolean)
language sql stable security invoker set search_path = ''
as $$
  select m.user_id, r.book, r.chapter, r.verse_start, r.verse_end,
    bool_or(coalesce(jsonb_typeof(v.progress -> 'easy' -> 'bestAccuracy') = 'number'
      or jsonb_typeof(v.progress -> 'medium' -> 'bestAccuracy') = 'number'
      or jsonb_typeof(v.progress -> 'hard' -> 'bestAccuracy') = 'number', false)),
    bool_or(coalesce(v.progress -> 'hard' -> 'completed' = 'true'::jsonb, false)),
    bool_or(coalesce(v.progress -> 'engraved' -> 'completed' = 'true'::jsonb, false))
  from public.shared_collection_members m
  join public.shared_collection_verses r on r.shared_collection_id = m.shared_collection_id
  join public.user_verses v on v.user_id = m.user_id and v.book = r.book and v.chapter = r.chapter
    and v.verse_start = r.verse_start and v.verse_end = r.verse_end
  where m.shared_collection_id = p_shared
  group by m.user_id, r.book, r.chapter, r.verse_start, r.verse_end;
$$;

-- Normalizes a typed or linked code; revoked reads as not found.
create function private.find_invite(p_code text)
returns public.shared_invites language plpgsql stable security invoker set search_path = ''
as $$
declare
  invite public.shared_invites%rowtype;
begin
  select * into invite from public.shared_invites
  where code = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) and revoked_at is null;
  if not found then
    raise exception 'Invite not found' using errcode = '22023';
  end if;
  if invite.expires_at <= now() then
    raise exception 'Invite expired' using errcode = '22023';
  end if;
  return invite;
end;
$$;

-- ---------- Client API

-- Definer: clients only read invites. The group lock makes rotations take turns, so
-- exactly one code is live after any number of concurrent calls.
create function private.mint_invite(p_shared uuid)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.shared_collections s
  where s.id = p_shared and s.owner_id = auth.uid()
  for update;
  if auth.uid() is null or not found then
    raise exception 'Only the owner can invite' using errcode = '42501';
  end if;
  update public.shared_invites as i set revoked_at = now()
  where i.shared_collection_id = p_shared and i.revoked_at is null;
  return query
    insert into public.shared_invites as i (shared_collection_id) values (p_shared)
    returning i.code, i.expires_at;
end;
$$;

-- Definer: the group and the owner's membership have no client insert, so the caps hold.
create function private.share_collection(p_collection_client_id text)
returns table (shared_id uuid, code text)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  limits record := private.shared_limits();
  source public.user_collections%rowtype;
  new_id uuid;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('curated-collection:' || me::text, 0));

  select * into source from public.user_collections c
  where c.user_id = me and c.client_id = p_collection_client_id and c.deleted_at is null
  for update;
  if not found then
    raise exception 'Collection not found' using errcode = '22023';
  end if;
  if source.is_default or source.client_id in ('my-verses', 'mastered', 'in-progress') then
    raise exception 'This collection can''t be shared' using errcode = '22023';
  end if;
  if source.shared_collection_id is not null then
    raise exception 'This collection is already shared' using errcode = '22023';
  end if;
  if length(source.name) > 80 or btrim(source.name) = '' then
    raise exception 'Give the collection a name of up to 80 characters to share it' using errcode = '22023';
  end if;
  if (select count(*) from public.shared_collection_members m where m.user_id = me) >= limits.collections then
    raise exception 'You can be in up to % shared collections', limits.collections using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles p where p.user_id = me and p.display_name is not null) then
    raise exception 'Add your name first' using errcode = '22023';
  end if;

  insert into public.shared_collections (owner_id, name, icon_key)
  values (me, source.name, source.icon_key)
  returning id into new_id;
  insert into public.shared_collection_members (shared_collection_id, user_id, role)
  values (new_id, me, 'owner');
  insert into public.shared_collection_verses (shared_collection_id, book, chapter, verse_start, verse_end, added_by)
  select distinct new_id, v.book, v.chapter, v.verse_start, v.verse_end, me
  from public.verse_collections vc
  join public.user_verses v on v.id = vc.verse_id
  where vc.collection_id = source.id and v.deleted_at is null;
  update public.user_collections set shared_collection_id = new_id where id = source.id;

  return query select new_id, i.code from private.mint_invite(new_id) i;
end;
$$;

create function private.preview_invite(p_code text)
returns table (shared_id uuid, name text, inviter_name text, verse_count integer, member_count integer, already_member boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  invite public.shared_invites%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  invite := private.find_invite(p_code);
  return query
    select s.id, s.name, p.display_name,
      (select count(*)::integer from public.shared_collection_verses r where r.shared_collection_id = s.id),
      (select count(*)::integer from public.shared_collection_members m where m.shared_collection_id = s.id),
      exists (select 1 from public.shared_collection_members m
        where m.shared_collection_id = s.id and m.user_id = auth.uid())
    from public.shared_collections s
    left join public.profiles p on p.user_id = s.owner_id
    where s.id = invite.shared_collection_id;
end;
$$;

create function private.join_shared_collection(p_code text, p_version text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  limits record := private.shared_limits();
  invite public.shared_invites%rowtype;
begin
  if me is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  invite := private.find_invite(p_code);
  perform pg_advisory_xact_lock(hashtextextended('curated-collection:' || me::text, 0));
  -- Serializes joins to one group so the member cap holds.
  perform 1 from public.shared_collections s where s.id = invite.shared_collection_id for update;

  if not exists (select 1 from public.shared_collection_members m
    where m.shared_collection_id = invite.shared_collection_id and m.user_id = me) then
    if (select count(*) from public.shared_collection_members m
      where m.shared_collection_id = invite.shared_collection_id) >= limits.members then
      raise exception 'This shared collection is full (% members)', limits.members using errcode = '22023';
    end if;
    if (select count(*) from public.shared_collection_members m where m.user_id = me) >= limits.collections then
      raise exception 'You can be in up to % shared collections', limits.collections using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles p where p.user_id = me and p.display_name is not null) then
      raise exception 'Add your name first' using errcode = '22023';
    end if;
    insert into public.shared_collection_members (shared_collection_id, user_id, role)
    values (invite.shared_collection_id, me, 'member');
  end if;

  return (private.sync_member_copies(me, invite.shared_collection_id, p_version)).local_client_id;
end;
$$;

-- Definer: it links the copy through shared_collection_id, which clients can't write.
create function private.sync_shared_collection(p_shared uuid, p_version text)
returns table (client_id text, changed boolean) language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_shared) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  return query select s.local_client_id, s.changed
    from private.sync_member_copies(auth.uid(), p_shared, p_version) s;
end;
$$;

-- Definer: members can't delete their membership row directly, so leaving always takes
-- the copy with it.
create function private.leave_shared_collection(p_shared uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_shared) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  if exists (select 1 from public.shared_collections s where s.id = p_shared and s.owner_id = auth.uid()) then
    raise exception 'The owner can''t leave' using errcode = '22023';
  end if;
  perform private.drop_member_collection(auth.uid(), p_shared);
end;
$$;

create function private.remove_shared_member(p_shared uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null
    or not exists (select 1 from public.shared_collections s where s.id = p_shared and s.owner_id = auth.uid()) then
    raise exception 'Only the owner can remove members' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'The owner can''t be removed' using errcode = '22023';
  end if;
  if not exists (select 1 from public.shared_collection_members m
    where m.shared_collection_id = p_shared and m.user_id = p_user) then
    raise exception 'Not a member' using errcode = '22023';
  end if;
  perform private.drop_member_collection(p_user, p_shared);
end;
$$;

create function private.read_shared_members(p_shared uuid)
returns table (user_id uuid, display_name text, role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_shared) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  return query
    select m.user_id, p.display_name, m.role, m.joined_at
    from public.shared_collection_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.shared_collection_id = p_shared
    order by m.role = 'owner' desc, m.joined_at, m.user_id;
end;
$$;

create function private.read_shared_progress(p_shared uuid)
returns table (user_id uuid, book text, chapter integer, verse_start integer, verse_end integer,
  practiced boolean, mastered boolean, engraved boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_member(p_shared) then
    raise exception 'Not a member' using errcode = '42501';
  end if;
  return query select * from private.member_squares(p_shared);
end;
$$;

-- Per group the caller is in. A square counts as mastered when mastered or engraved.
create function private.read_shared_status()
returns table (shared_id uuid, member_count integer, verse_count integer, mastered_squares integer, engraved_squares integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return query
    select mine.shared_collection_id,
      (select count(*)::integer from public.shared_collection_members m where m.shared_collection_id = mine.shared_collection_id),
      (select count(*)::integer from public.shared_collection_verses r where r.shared_collection_id = mine.shared_collection_id),
      (select count(*) filter (where sq.mastered or sq.engraved)::integer from private.member_squares(mine.shared_collection_id) sq),
      (select count(*) filter (where sq.engraved)::integer from private.member_squares(mine.shared_collection_id) sq)
    from public.shared_collection_members mine
    where mine.user_id = auth.uid();
end;
$$;

-- ---------- Triggers

-- Dissolve: before the group goes, every member's copy catches up in their translation, so
-- the personal copy the foreign key leaves behind has every reference. The owner is skipped:
-- their copy is theirs already, and on account deletion their rows are going.
create function private.sync_members_before_dissolve() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  member record;
begin
  for member in
    select m.user_id, coalesce(p.translation, 'ESV') as translation
    from public.shared_collection_members m
    left join public.profiles p on p.user_id = m.user_id
    where m.shared_collection_id = old.id and m.role <> 'owner'
  loop
    perform private.sync_member_copies(member.user_id, old.id, member.translation);
  end loop;
  return old;
end;
$$;
create trigger sync_members_before_dissolve
  before delete on public.shared_collections
  for each row execute function private.sync_members_before_dissolve();

-- Editors' removals reach every member's copy at once with today's delete rule, so sync can
-- treat anything else in a copy as the member's own verse. Skipped while the group itself is
-- being deleted (the cascade), which dissolves instead.
create function private.remove_reference_from_copies() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  copy record;
begin
  if not exists (select 1 from public.shared_collections s where s.id = old.shared_collection_id) then
    return null;
  end if;
  for copy in
    select c.user_id, c.id as collection_id, vc.verse_id
    from public.user_collections c
    join public.shared_collection_members m on m.shared_collection_id = c.shared_collection_id and m.user_id = c.user_id
    join public.verse_collections vc on vc.collection_id = c.id
    join public.user_verses v on v.id = vc.verse_id
    where c.shared_collection_id = old.shared_collection_id
      and v.book = old.book and v.chapter = old.chapter
      and v.verse_start = old.verse_start and v.verse_end = old.verse_end
  loop
    perform private.remove_verse_from_collection(copy.user_id, copy.verse_id, copy.collection_id);
  end loop;
  return null;
end;
$$;
create trigger remove_reference_from_copies
  after delete on public.shared_collection_verses
  for each row execute function private.remove_reference_from_copies();

-- References per group. The group lock makes concurrent adds take turns.
create function private.check_reference_cap() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  cap integer := (private.shared_limits()).verses;
begin
  perform 1 from public.shared_collections s where s.id = new.shared_collection_id for update;
  if (select count(*) from public.shared_collection_verses r where r.shared_collection_id = new.shared_collection_id) >= cap then
    raise exception 'A shared collection holds up to % verses', cap using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger check_reference_cap
  before insert on public.shared_collection_verses
  for each row execute function private.check_reference_cap();

-- Invoker wrappers: the only shared-collection functions PostgREST exposes.
create function public.share_collection(p_collection_client_id text)
returns table (shared_id uuid, code text)
language sql security invoker set search_path = ''
as $$ select * from private.share_collection(p_collection_client_id) $$;

create function public.mint_invite(p_shared uuid)
returns table (code text, expires_at timestamptz)
language sql security invoker set search_path = ''
as $$ select * from private.mint_invite(p_shared) $$;

create function public.sync_shared_collection(p_shared uuid, p_version text)
returns table (client_id text, changed boolean)
language sql security invoker set search_path = ''
as $$ select * from private.sync_shared_collection(p_shared, p_version) $$;

create function public.leave_shared_collection(p_shared uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.leave_shared_collection(p_shared) $$;

create function public.preview_invite(p_code text)
returns table (shared_id uuid, name text, inviter_name text, verse_count integer, member_count integer, already_member boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.preview_invite(p_code) $$;

create function public.join_shared_collection(p_code text, p_version text)
returns text language sql security invoker set search_path = ''
as $$ select private.join_shared_collection(p_code, p_version) $$;

create function public.remove_shared_member(p_shared uuid, p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_shared_member(p_shared, p_user) $$;

create function public.get_shared_members(p_shared uuid)
returns table (user_id uuid, display_name text, role text, joined_at timestamptz)
language sql stable security invoker set search_path = ''
as $$ select * from private.read_shared_members(p_shared) $$;

create function public.get_shared_progress(p_shared uuid)
returns table (user_id uuid, book text, chapter integer, verse_start integer, verse_end integer,
  practiced boolean, mastered boolean, engraved boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.read_shared_progress(p_shared) $$;

create function public.get_shared_status()
returns table (shared_id uuid, member_count integer, verse_count integer, mastered_squares integer, engraved_squares integer)
language sql stable security invoker set search_path = ''
as $$ select * from private.read_shared_status() $$;

-- ---------- Privileges

revoke all on function
  private.shared_limits(), private.new_invite_code(), private.is_member(uuid), private.can_edit(uuid),
  private.remove_verse_from_collection(uuid, uuid, uuid), private.sync_member_copies(uuid, uuid, text),
  private.drop_member_collection(uuid, uuid), private.member_squares(uuid), private.find_invite(text),
  private.mint_invite(uuid), private.share_collection(text), private.preview_invite(text),
  private.join_shared_collection(text, text), private.sync_shared_collection(uuid, text),
  private.leave_shared_collection(uuid), private.remove_shared_member(uuid, uuid),
  private.read_shared_members(uuid), private.read_shared_progress(uuid), private.read_shared_status(),
  private.sync_members_before_dissolve(), private.remove_reference_from_copies(), private.check_reference_cap()
  from public, anon, authenticated;

-- The policy helpers, and the definer bodies the public wrappers call (PostgREST doesn't
-- expose private). Everything that writes for a given user stays out of clients' reach.
grant execute on function
  private.is_member(uuid), private.can_edit(uuid),
  private.mint_invite(uuid), private.share_collection(text), private.preview_invite(text),
  private.join_shared_collection(text, text), private.sync_shared_collection(uuid, text),
  private.leave_shared_collection(uuid), private.remove_shared_member(uuid, uuid),
  private.read_shared_members(uuid), private.read_shared_progress(uuid), private.read_shared_status()
  to authenticated;

revoke all on function
  public.mint_invite(uuid), public.share_collection(text), public.preview_invite(text),
  public.join_shared_collection(text, text), public.sync_shared_collection(uuid, text),
  public.leave_shared_collection(uuid), public.remove_shared_member(uuid, uuid),
  public.get_shared_members(uuid), public.get_shared_progress(uuid), public.get_shared_status()
  from public, anon;
grant execute on function
  public.mint_invite(uuid), public.share_collection(text), public.preview_invite(text),
  public.join_shared_collection(text, text), public.sync_shared_collection(uuid, text),
  public.leave_shared_collection(uuid), public.remove_shared_member(uuid, uuid),
  public.get_shared_members(uuid), public.get_shared_progress(uuid), public.get_shared_status()
  to authenticated;
