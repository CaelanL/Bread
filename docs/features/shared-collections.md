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
- `shared_collection_members` has one owner per group (partial unique index).
- `profiles.display_name` (1 to 40 characters) is the name members see. See
  [auth.md](../architecture/auth.md#display-name).

Old clients ignore the new tables and column, and see a member's copy as an ordinary
collection. What they can do to it is repaired by the next sync (below).

## Access rules

RLS on all four tables, through two `SECURITY DEFINER` helpers used only inside
policies, `private.is_member(group)` and `private.can_edit(group)` (owner or editor),
so the members table's own policy doesn't recurse.

| Table | Read | Write |
|---|---|---|
| `shared_collections` | members | owner updates `name`, `icon_key`; owner deletes. No client insert |
| `shared_collection_members` | members | owner updates `role` of non-owners to editor or member; a non-owner deletes their own row. No client insert |
| `shared_collection_verses` | members | owner and editors insert (as themselves) and delete |
| `shared_invites` | owner | owner inserts `shared_collection_id` only (code and expiry are defaults) and updates `revoked_at` |

Column grants back the policies: nobody can move a membership to another account or
another group, change `owner_id`, or pick their own invite code or expiry. `anon` has
nothing. Groups and memberships are created only by `share_collection` and
`join_shared_collection`, so the caps hold.

Members never read each other's `user_verses`. Cross-user reads go through definer
functions in `private` behind invoker wrappers in `public` (PostgREST exposes only
`public`), the pattern `curated_collection_savers` set. They return per-member booleans
per reference, never a member's progress itself, study prefs or timestamps. A removed
member reads nothing again.

## Functions

All `set search_path = ''`. `42501` means not signed in or not allowed, `22023` bad
input; `22023` messages are written to be shown as is.

| Function | Who | Does |
|---|---|---|
| `share_collection(client_id)` | signed in, has a display name | Copies a custom collection's name, icon and active references into a new group, makes the caller owner, links their row, mints the first invite. Refuses My Verses, virtual ids and already-shared rows. Returns `(shared_id, code)` |
| `mint_invite(group)` | owner | Revokes open invites, returns a new `(code, expires_at)` |
| `preview_invite(code)` | signed in | `(shared_id, name, inviter_name, verse_count, member_count, already_member)`. `Invite expired` / `Invite not found` (revoked reads as not found) |
| `join_shared_collection(code, version)` | signed in, has a display name | Joins as `member` and syncs; a member's repeat join only syncs. Returns the local `client_id` |
| `sync_shared_collection(group, version)` | member | Syncs the caller's copy. Returns the local `client_id` |
| `leave_shared_collection(group)` | non-owner member | Drops the caller's membership and copy |
| `remove_shared_member(group, user)` | owner | Drops another member's membership and copy |
| `get_shared_members(group)` | member | `(user_id, display_name, role, joined_at)`, owner first |
| `get_shared_progress(group)` | member | One row per member × reference they hold: `(user_id, book, chapter, verse_start, verse_end, practiced, mastered, engraved)` |
| `get_shared_status()` | signed in | Per group the caller is in: `(shared_id, member_count, verse_count, mastered_squares, engraved_squares)` |

Codes are normalized on input (upper case, spaces and dashes dropped). They're 8
characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1 or I).

Squares (`private.member_squares`, shared by the last two): a member's rows for a
reference, in any translation and soft-deleted ones included, are folded with `bool_or`.
`practiced` = any difficulty has a `bestAccuracy`; `mastered` = `hard.completed`;
`engraved` = `engraved.completed`. A reference a member holds no row for is missing from
`get_shared_progress`, and the client reads it as Open. `mastered_squares` counts a square
that is mastered or engraved.

Helpers in `private`: `shared_limits()`, `new_invite_code()`, `is_member`, `can_edit`,
`remove_verse_from_collection`, `sync_member_copies`, `drop_member_collection`,
`member_squares`, `find_invite`, and the definer bodies of the wrappers above. The
helpers that write take the user they act for but are `SECURITY INVOKER`: called from a
client wrapper, RLS keeps them to the caller's own rows; only the definer functions
(join, remove) act for someone else.

## Caps

`private.shared_limits()` returns 30 members per group, 20 shared collections per
person (owned or joined) and a 14-day invite lifetime. `lib/shared/constants.ts`
mirrors them as `MAX_SHARED_MEMBERS`, `MAX_SHARED_COLLECTIONS` and `INVITE_TTL_DAYS`;
change both together.

## Sync

`private.sync_member_copies(user, group, version)` makes the member's local collection
match the group, under the same per-account lock as `import_curated_collection`:

1. Finds the member's row by `shared_collection_id`, else inserts one. Restores it if
   soft-deleted (an old client "deleted" it, or the member is rejoining) and copies the
   group's name and icon.
2. For each reference, links a held row (active first, then the account translation,
   then the newest), restoring a soft-deleted one, else inserts a new row in `version`.
3. Removes each linked verse whose reference left the group, with the delete rule below.
   This also removes a verse an old client added to a member's copy by hand.

It runs inside join and whenever a member calls `sync_shared_collection`.

## Leave and remove

`private.drop_member_collection` deletes the membership, then for each verse in the
member's copy runs `private.remove_verse_from_collection`, the SQL twin of `deleteVerse`
in `lib/store/index.ts` ([library.md](library.md#deleting-a-verse)): drop the link; a verse
in no other collection is soft-deleted when mastered and hard-deleted otherwise. Then it
soft-deletes the copy, which keeps its `shared_collection_id` so a rejoin restores it.
Nothing of another member's changes. The owner can't leave or be removed.

## Dissolve

Deleting the group row (owner `DELETE` under RLS, or the owner's account deletion
cascading from `auth.users`) sets every member's `shared_collection_id` to NULL through
the foreign key, in the same statement. Each copy becomes a personal collection with its
verses and links untouched. Memberships, references and invites cascade away.

## Seed users

`supabase/seed.sql`: `reader-c` (Cara, ESV) owns "Romans 8" and `reader-d` (Dana, NIV) is
a member. Romans 8:1 is engraved by both, 8:28 mastered by Cara and learning for Dana,
8:38-39 untouched. Invite code `BREAD828`. `reader-a` and `reader-b` belong to no group.

## Sharp edges

- `scripts/check-migrations.mjs` flags the migration's `delete from` statements (function
  bodies); it needs a `-- destructive-ok` line from Caelan before release.
- A shared reference a member's translation leaves out still gets a copy in their
  translation with no text, the same as `addVerse`.
- A member who removed a mastered copy through an old client still shows Mastered,
  since squares read soft-deleted rows.
- A client can set its own `user_collections.shared_collection_id` to any group id (the
  existing update policy covers the column). It gains nothing: every shared read checks
  membership.

## Decisions

- 2026-11-11 · Each member has an ordinary collection linked by a nullable `shared_collection_id` · Every screen, sort, delete rule and session path works unchanged, and old clients see a normal collection.
- 2026-11-11 · Cross-user reads are definer functions in `private` returning booleans per reference · A policy letting members read each other's `user_verses` would slow every verse query and leak prefs, timestamps and scores.
- 2026-11-11 · Dissolve is `ON DELETE SET NULL`, not an RPC · One statement, atomic, and the owner's account deletion gets the same result.
- 2026-11-11 · Leave, remove and sync use a SQL twin of the delete rule · Remove is a cross-user write, so it has to run server-side; one function keeps one rule for all three.
- 2026-11-11 · `share_collection` is definer-backed and clients can't insert groups or memberships · Otherwise a client could create groups directly and skip the caps and the display-name rule.
- 2026-11-11 · Shared references allow any range up to verse 176, not the curated import's two-verse limit · Users' own collections hold ranges like Psalm 23:1-3, and those must be shareable.
- 2026-11-11 · Shared collections need a display name, and My Verses and the virtual collections can't be shared · Every member has a name in the grid; sharing My Verses would share everything.
