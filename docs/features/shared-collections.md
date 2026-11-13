# Shared collections

A person shares one of their collections by invite code. Members memorize the same
references, each in their own account translation, and see where every member is on
every verse. Schema: `supabase/migrations/20261112003908_shared_collections.sql`.
Tests: `supabase/tests/shared-collections.test.sql`.

## Data model

A shared collection is a group record plus one ordinary collection per member:

```
shared_collections (id, owner_id, name, icon_key)         owner-owned group
  ├── shared_collection_members (user_id, role)           owner | editor | member
  ├── shared_collection_verses (book, chapter, vs, ve)    the reference list, never text
  └── shared_invites (code, expires_at, revoked_at)       8-character codes, 14 days
user_collections.shared_collection_id → shared_collections (nullable, ON DELETE SET NULL)
```

- Every member, owner included, has a normal `user_collections` row pointing at the
  group. A member's row has `client_id = 'shared-<group id>'`, so joining twice finds it;
  the owner's row keeps the id it had before sharing.
- A member's copies are normal `user_verses` rows in their account translation, linked
  through `verse_collections`. Mastery and engraved stay in `updateVerseProgress`
  (invariant 7). No new table holds verse text (invariant 2).
- `shared_collection_verses` is the truth for what's in the group. Its primary key is
  the group plus the exact reference: Romans 8:28-30 and Romans 8:28 are different verses.
  `book` must be one of the 66 canonical names in `BIBLE_BOOKS` (`lib/bible/books.ts`);
  `lib/shared/books.test.ts` keeps the SQL list in step.
- `shared_collection_members` has one owner per group (partial unique index).
- `profiles.display_name` ("Caelan L.") is the name members see. See
  [auth.md](../architecture/auth.md#display-name).

The next sync (below) repairs what an old client does to a member's copy.

## Access rules

RLS on all four tables, through two `SECURITY DEFINER` helpers used only inside
policies, `private.is_member(group)` and `private.can_edit(group)` (owner or editor),
so the members table's own policy doesn't recurse.

| Table | Read | Write |
|---|---|---|
| `shared_collections` | members | owner updates `name`, `icon_key`; owner deletes. No client insert |
| `shared_collection_members` | members | owner updates `role` of non-owners to editor or member. No client insert or delete: leaving goes through `leave_shared_collection`, so the copy always goes too |
| `shared_collection_verses` | members | owner and editors insert (as themselves) and delete |
| `shared_invites` | owner | none: only `mint_invite` writes, so one code is live and a revoked one stays revoked |
| `user_collections.shared_collection_id` | owner of the row | none: insert and update are column grants that leave it out; only share, join and sync set it |

Column grants back the policies: nobody can move a membership to another account or
another group or change `owner_id`. `anon` has nothing.

Members never read each other's `user_verses`. Cross-user reads go through definer
functions in `private` behind invoker wrappers in `public` (PostgREST exposes only
`public`). They return per-member booleans
per reference, never a member's progress itself, study prefs or timestamps. A removed
member reads nothing again.

## Functions

All `set search_path = ''`. `42501` means not signed in or not allowed, `22023` bad
input; `22023` messages are written to be shown as is.

| Function | Who | Does |
|---|---|---|
| `share_collection(client_id)` | signed in, has a display name | Copies a custom collection's name, icon and active references into a new group, makes the caller owner, links their row, mints the first invite. Refuses My Verses, virtual ids and already-shared rows. Returns `(shared_id, code)` |
| `mint_invite(group)` | owner | Locks the group, revokes open invites, returns a new `(code, expires_at)` |
| `preview_invite(code)` | signed in | `(shared_id, name, inviter_name, verse_count, member_count, already_member)`. `Invite expired` / `Invite not found` (revoked reads as not found) |
| `join_shared_collection(code, version)` | signed in, has a display name | Joins as `member` and syncs; a member's repeat join only syncs. Returns the local `client_id` |
| `sync_shared_collection(group, version)` | member | Syncs the caller's copy. Returns `(client_id, changed)`: `changed` is true when it created, restored, renamed, linked or removed anything |
| `leave_shared_collection(group)` | non-owner member | Drops the caller's membership and copy |
| `remove_shared_member(group, user)` | owner | Drops another member's membership and copy |
| `get_shared_members(group)` | member | `(user_id, display_name, role, joined_at)`, owner first |
| `get_shared_progress(group)` | member | One row per member × reference they hold: `(user_id, book, chapter, verse_start, verse_end, practiced, mastered, engraved)` |
| `get_shared_status()` | signed in | Per group the caller is in: `(shared_id, member_count, verse_count, mastered_squares, engraved_squares)` |

Codes are normalized on input (upper case, no spaces or dashes): 8 characters from
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.

The last two count squares through `private.member_squares`
([group-progress.md](group-progress.md#squares)).

Every wrapper calls a `SECURITY DEFINER` body in `private` that checks the caller and
passes `auth.uid()` on. The `private` helpers that write take the user they act for, so
clients can't execute them; only the definer bodies and the triggers call them.

## Caps

`private.shared_limits()` returns 30 members per group, 20 shared collections per
person (owned or joined), a 14-day invite lifetime and 200 references per group.
`lib/shared/constants.ts` mirrors them as `MAX_SHARED_MEMBERS`, `MAX_SHARED_COLLECTIONS`,
`INVITE_TTL_DAYS` and `MAX_SHARED_VERSES`; change both together. The reference cap is a
`BEFORE INSERT` trigger that locks the group, so editors' inserts and `share_collection` both
hit it.

## Sync

`private.sync_member_copies(user, group, version)` makes the member's local collection
match the group. It holds the group row (share), the per-account lock of
`import_curated_collection` and the member's row, then rechecks membership: a leave or
removal holds the group row for update first, so a sync that started before it commits
writes nothing and returns `changed = false`.

1. Finds the member's row by `shared_collection_id`, else inserts one. Restores it if
   soft-deleted (an old client "deleted" it, or the member is rejoining) and copies the
   group's name and icon.
2. For each reference, links a held row (active first, then the account translation,
   then the newest), restoring a soft-deleted one, else inserts a new row in `version`.
3. Moves any linked verse that isn't a group reference (an old client added it to the
   copy by hand) to My Verses, creating My Verses if needed. It is never deleted and keeps
   progress.

It runs in join, in `sync_shared_collection`, and for every member before the group is
deleted.

Removing a reference doesn't wait for sync: the `remove_reference_from_copies` trigger
applies the delete rule below to every member's copy of it at once. That is why step 3
can treat everything else in a copy as the member's own verse.

## Leave and remove

`private.drop_member_collection` deletes the membership, then for each verse in the
member's copy runs `private.remove_verse_from_collection`, the
[delete rule](library.md#deleting-a-verse). Then it soft-deletes the copy, keeping its
`shared_collection_id` so a rejoin restores it. Nothing of another member's changes. The owner can't leave or be removed.

## Dissolve

Deleting the group row (owner `DELETE` under RLS from Stop sharing or Delete, or the owner's
account deletion cascading from `auth.users`) first runs `sync_members_before_dissolve`: every member but
the owner is synced in their `profiles.translation` (ESV when unset), so a reference they
never opened still reaches their copy. Then the foreign key sets every member's
`shared_collection_id` to NULL in the same statement. Each copy becomes a personal
collection. Memberships, references and invites cascade away; the removal trigger skips
the cascade.

## Privacy

Squares fold every row a member holds for a reference, older progress included, so whoever
adds a reference sees whether members already practiced or mastered it. The join modal says so.

## In the app

State and actions live in the store ([sync-and-storage.md](../architecture/sync-and-storage.md#shape)):
`Collection.sharedId` is `shared_collection_id`; `sharedCollections` (role, counts, squares per
group) is read on hydrate and refresh. Failures throw for a toast, nothing queued;
`sharedErrorMessage` (`lib/shared/invite-code.ts`) shows `22023` text as is.

- **Share**: Share… on a collection you own, or New shared collection on the Library's + menu
  ([library.md](library.md#sharing-from-the-library)), opens `app/share/[id].tsx`: a name
  (`DisplayNameForm`) once, then `shareCollection` and the panel. At 20 groups a new share toasts
  (`shareHitsCap`). From that tap there's a code, but until someone joins it acts personal
  ([group progress](group-progress.md#collection-screen)); the panel says "Not shared yet".
- **Share panel** (`SharePanel`, also the bar's person-plus): members, roles;
  `?view=members` shows only the members. It opens at full size (stand-ins until loaded).
  The owner also gets the code, copy icon, days left, Share, New code (confirmed, old code
  dies), the [member actions](group-progress.md#whos-where) and Stop sharing. Share sends
  `inviteMessage`: app link, App Store link, code. Members get Leave.
- **Stop sharing** (owner; confirm names who's affected): `stopSharing` deletes the group ([dissolve](#dissolve));
  codes die, every copy is personal again.
- **Join**: `app/join/[code].tsx` (link) and `app/join/index.tsx` (typed) show `JoinInvite`:
  inviter, name, counts, the privacy line with the account translation, and Join (a name if
  needed, `joinSharedCollection`, then the copy with one `dismissTo`). A member sees Open; a bad
  code shows its message. A signed-out link's code waits in AsyncStorage
  (`lib/shared/pending-join.ts`) through sign-in, email confirmation or an app kill, then opens
  over the Library; the reminders card is held until that read.
- **Inside**: [group-progress.md](group-progress.md). Only the owner and editors see + and
  swipe-delete; only the owner renames or changes the icon. `addVerse` inserts the reference and
  syncs; `deleteVerse` deletes it ("Remove for everyone?" once others joined).
  Copy-to-collection lists your own that no one joined (`addSharedVerse`); Add-to-collection,
  ones you edit (sync moves hand-linked verses to My Verses).
- **Leave and delete**: a member's swipe and menu read Leave (`collectionRemoval`); the
  confirm counts verses lost. Once others joined, the owner's Delete asks "Delete for everyone?
  Members keep their own copy."; it stops sharing, then deletes the owner's copy. Confirms and
  their failure toasts: `member-actions.ts`.
- **Gone groups**: each fetch keeps the account's groups in AsyncStorage; one gone by the next
  toasts once: "You were removed from <name>." or "<name> is now your own copy." (dissolved).
  Not for groups you left or own.

## Seed users

`supabase/seed.sql`'s header: `reader-c` (Cara) owns "Romans 8" with `reader-d` (Dana),
code `BREAD828`, and the groups in [group-progress.md](group-progress.md#browser-checks).
`reader-a` and `reader-b` are in no group.

## Sharp edges

- Leaving on another device reads as "You were removed" on this one.
- A shared reference a member's translation leaves out still gets a copy in their
  translation with no text, the same as `addVerse`.
- A member who removed a mastered copy through an old client still shows Mastered,
  since squares read soft-deleted rows.
- Dissolve restores a member's copy that an old client soft-deleted while they were
  still a member, since it runs a full sync.
- New `user_collections` columns need adding to the insert and update column grants.

## Browser checks

After `npm run db:reset` each: `npm run sim -- flow shared-collections` (share, copy, join by
link, both in the list, leave, rejoin, delete for everyone, personal copy) and
`npm run sim -- flow shared-join-code` (typed code, revoked code, link across sign-in to the
modal over the Library, close, Join) and `npm run sim -- flow shared-stop` (a code alone keeps the
card personal, Stop sharing alone and with members, the old code dead).

## Decisions

- 2026-11-11 · Each member has an ordinary collection linked by a nullable `shared_collection_id` · Every screen, sort, delete rule and session path works unchanged, and old clients see a normal collection.
- 2026-11-11 · Cross-user reads are definer functions in `private` returning booleans per reference · A policy letting members read each other's `user_verses` would slow every verse query and leak prefs, timestamps and scores.
- 2026-11-11 · Dissolve is `ON DELETE SET NULL`, not an RPC · One statement, atomic, and the owner's account deletion gets the same result.
- 2026-11-11 · Leave, remove and sync use a SQL twin of the delete rule · Remove is a cross-user write, so it has to run server-side; one function keeps one rule for all three.
- 2026-11-11 · `share_collection` is definer-backed and clients can't insert groups or memberships · Otherwise a client could create groups directly and skip the caps and the display-name rule.
- 2026-11-11 · Shared references allow any range up to verse 176, not the curated import's two-verse limit · Users' own collections hold ranges like Psalm 23:1-3, and those must be shareable.
- 2026-11-11 · `sync_shared_collection` returns `changed` with the local `client_id` · Opening a shared collection syncs every time; a removed reference, a removal or a dissolve reaches the copy without sync, so open reloads the copy either way.
- 2026-11-11 · A dissolve syncs every member first (one-time fan-out) · Without it a member who never reopened the collection keeps a copy missing the latest references.
- 2026-11-11 · An editor's removal reaches every copy at once; sync moves anything else in a copy to My Verses · Sync can't tell a removed reference from an old client's own verse, and a member's own verse is never deleted by sync.
- 2026-11-11 · Mint, leave and sync are definer-backed; clients can't write invites, delete memberships or set `shared_collection_id` · Each direct path skipped a rule: extra or revived codes, a membership dropped without its copy, a collection linked to a group without joining.
- 2026-11-12 · Shared only once someone besides the owner is in it, from `member_count`, no new column · Caelan: an accidental Share tap mustn't turn a collection shared.
- 2026-11-12 · Stop sharing deletes the group, members or not · The dissolve keeps copies and kills codes; no migration.
- 2026-11-11 · Shared collections need a display name, and My Verses and the virtual collections can't be shared · Every member has a name in the grid; sharing My Verses would share everything.
- 2026-11-12 · No Leave or Delete until the role loads · A guess shows the wrong confirm; the store refuses it anyway.
