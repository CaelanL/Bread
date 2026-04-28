# Feature: Per-Collection Sort Persistence

> **Status:** `superseded`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Shipped:** —
>
> **Superseded by:** `docs/features/library-sort-persistence-and-last-practiced.md`
> — that doc rolls this plan in unchanged on the persistence axis
> and adds the "Recent → Last Practiced" semantics change on top.
> Building together avoided two rounds of churn through the same
> screen + sort enum.
>
> The content below is preserved as historical context. Do not
> implement from this doc.

## Problem

Today, opening any collection in Library resets the sort selector to
`Recent` every single time. The state is plain `useState` in
`app/(tabs)/(library)/[id].tsx`:

```ts
const [sortBy, setSortBy] = useState<'recent' | 'alphabetical' | 'mastery'>('recent');
```

This means a user who prefers viewing "Truth" alphabetically and
"Mastered" by mastery has to re-pick those sorts every time they
navigate. The cost is small in isolation but is felt every session,
and gets worse when the upcoming review-system feature adds a "Due
first" sort that should *clearly* be the default for Mastered (and
losing it on every navigation defeats the point).

Spotify-style "the way I left this collection is how I find it next
time" is the target.

## Solution

Per-collection sort preference, persisted to Supabase on the row
where the collection lives. The Mastered virtual collection (and the
forthcoming In Progress virtual collection) have no DB row, so their
sort preference is stored in AsyncStorage instead.

Concretely:

- `user_collections` gets a new nullable `sort_preference TEXT`
  column. NULL = "use the default" (Recent).
- Virtual collections (`mastered`, `in-progress`) store sort in
  AsyncStorage under fixed keys.
- The collection-detail screen reads sort from this layer, writes
  back when the user toggles the sort cycle.
- Sort options remain `recent` | `alphabetical` | `mastery`.
  (`due-first` was added to the cycle by review-system using local
  `useState`; this feature persists it like the other options.)

## Requirements

### Must have

- [ ] `user_collections.sort_preference TEXT NULL` column added by
      additive migration.
- [ ] Each user collection's sort persists across app close/reopen,
      device restart, and re-sign-in.
- [ ] Mastered collection's sort persists across the same.
- [ ] Sort preference syncs across devices (because it's on the DB
      row for user collections; AsyncStorage for virtual
      collections is intentionally device-local).
- [ ] Default sort remains `recent` when `sort_preference` is NULL
      / unset (no behavior change for existing users on first load).
- [ ] No performance regression on the Library list — we don't add
      extra fetches.
- [ ] Old client tolerates the new column (it ignores unknown
      columns; verified by reading existing Supabase select calls).
- [ ] New client tolerates an unmigrated DB (column missing → row
      shape lacks `sort_preference` → falls back to default).

### Nice to have

- [ ] In Progress virtual collection sort persists too (review-
      system already added the In Progress collection; this feature
      just persists its sort like the others).

### Explicitly out of scope

- Per-collection *filter* preferences. Sort only.
- Cross-device sync of virtual-collection sorts (intentional: those
  are device-local; promoting them to per-user state requires a
  schema change for a virtual concept and isn't worth the cost).
- Historical sort preferences (e.g. "what sort did I have a week
  ago"). Single value per collection.
- Per-user default sort (e.g. "make alphabetical the default for
  *all* my collections"). Defaults are global and hardcoded.
- Backfilling sort preference from any existing analytics —
  start NULL / use default.

## Open Questions

### Q1: Default sort for the Mastered virtual collection

When sort preference is unset (first time the user opens Mastered
on a new device), what's the default? Note that by the time this
ships, review-system has already added `due-first` to the cycle.

- **Option A — `recent`** *(matches today's behavior; predictable.)*
- **Option B — `mastery`** *(arguably what users want from Mastered
  since the verses are *all* mastered; could be confusing.)*
- **Option C — `due-first`** *(matches the new feature's intent —
  Mastered should surface what needs review by default. Best
  default for review-aware users.)*

Lean **C** for Mastered specifically: review-system makes
`due-first` the most useful default. Other collections still
default to `recent`.

### Q2: Where does virtual-collection sort live?

- **Option A — AsyncStorage with a fixed key per virtual id**
  (`@library_sort:mastered`, `@library_sort:in-progress`).
  *(Simple; device-local — sort doesn't sync across the user's
  devices.)*
- **Option B — A new `user_settings` table or extension to a
  per-user JSONB blob.** *(Syncs; more schema work.)*
- **Option C — Synthesize a real DB row for virtual collections.**
  *(Breaks the "Mastered has no DB row" invariant; spreads concern.)*

Lean A. Mastered/In-Progress are virtual; their UI state being
device-local matches the existing pattern (`colorMode`,
`bibleVersion`).

### Q3: When does the sort write happen?

- **Option A — On every cycle of the sort selector**
  (write-on-toggle). *(Snappy; small writes; could spam Supabase if
  the user cycles fast.)*
- **Option B — On screen blur / nav-away.** *(Batched; risk of
  lost write if app crashes.)*

Lean A. Each toggle is one tiny UPDATE; debouncing is overkill.

### Q4: How does this feature handle the existing `due-first` from review-system?

By the time this feature is built, review-system has already
shipped `due-first` to the Mastered collection's sort cycle using
local `useState` — it's a real, used option. This feature just
adds persistence on top.

- **Option A — Persist `due-first` like the others.** It's an enum
  value in the union; storage CHECK constraint accepts it; default
  for Mastered can become `due-first` if there are due verses.
  *(Most natural; matches user expectation.)*
- **Option B — Don't persist `due-first`** specifically; let it
  reset on nav while other sorts persist. *(Inconsistent UX; no
  reason to do this.)*

Lean A.

## Technical Approach

### Data model changes

**One new migration**: `supabase/migrations/014_collection_sort.sql`
(if shipping before review-system) or `015_collection_sort.sql` (if
after). The build order section addresses sequencing.

```sql
-- 014_collection_sort.sql (or 015 — pick whichever isn't taken)
-- Add per-collection sort preference. Nullable so existing rows
-- default to client-side default sort. Old clients tolerate unknown
-- columns on SELECT.

ALTER TABLE public.user_collections
ADD COLUMN sort_preference TEXT NULL
CHECK (sort_preference IN ('recent', 'alphabetical', 'mastery', 'due-first'));

COMMENT ON COLUMN public.user_collections.sort_preference IS
'Per-collection sort. NULL = client default. due-first applies to Mastered only (introduced by review-system feature).';
```

CHECK constraint includes `due-first` even though the UI for it
ships in review-system — keeps schema and review-system feature
fully decoupled (each can ship in either order).

**No new indexes.** The column is read alongside the existing
collections fetch; there's no query that filters by it.

**No RLS changes.** Existing `user_collections` policies cover the
new column (it lives on the same row).

**No new triggers/functions.** `update_user_collections_updated_at`
already fires on UPDATE.

### Sync impact

Adds one field to the collection read path (`getCollections()` in
`lib/storage/index.ts`) and one write path (a new
`updateCollectionSort(id, sort)` storage function). Optimistic
updates: write to Supabase, then update Zustand on success — same
pattern as `setColorMode`. Failure throws; sort visually reverts
(or we can show an error toast).

### Cache impact

**None.** Verse text caching unaffected.

### Client changes

**Files added**:

- `lib/store/library-sort.ts` — pure helpers:
  - `type SortOption = 'recent' | 'alphabetical' | 'mastery' | 'due-first'`
  - `DEFAULT_SORT: SortOption = 'recent'`
  - `cycleSort(current: SortOption): SortOption`
  - `getSortLabel(s: SortOption): string`
  - `sortVerses(verses: SavedVerse[], sort: SortOption, now: Date): SavedVerse[]`
    (lifted out of `[id].tsx`; takes an explicit `now` so the
    review-system feature can supply it for `due-first` later)

**Files modified**:

- `supabase/migrations/0NN_collection_sort.sql` — new (above).
- `lib/storage/index.ts`:
  - `Collection` type: add `sortPreference?: SortOption`.
  - `getCollections()`: select `sort_preference`, map to
    `sortPreference` on the returned object.
  - New `updateCollectionSort(id, sort)`:
    `supabase.from('user_collections').update({ sort_preference: sort }).eq('client_id', id)`.
  - New `setMasteredSort(sort)` / `getMasteredSort()` helpers
    backed by AsyncStorage key `@library_sort:mastered`.
  - New `setInProgressSort(sort)` / `getInProgressSort()` helpers
    backed by AsyncStorage key `@library_sort:in-progress`
    (reserved for review-system; lives here so both features share
    one persistence layer).
- `lib/store/index.ts`:
  - Add `setCollectionSort(collectionId, sort)` action that:
    - For `MASTERED_COLLECTION_ID` → calls `setMasteredSort`,
      updates Zustand.
    - For `IN_PROGRESS_COLLECTION_ID` (will exist after review-
      system) → calls `setInProgressSort`, updates Zustand.
    - Otherwise → calls `updateCollectionSort`, updates Zustand.
  - Hydrate loads `masteredSort` from AsyncStorage alongside other
    settings.
  - `clear()` exempts the AsyncStorage sort keys (device prefs).
  - Selector `useCollectionSort(collectionId)` returns the current
    sort for a collection (or default if unset).
- `app/(tabs)/(library)/[id].tsx`:
  - Replace `useState<SortOption>('recent')` with
    `useCollectionSort(id)` selector + `setCollectionSort` action.
  - `cycleSortBy()` calls the action instead of `setSortBy`.
  - Remove the inline sort logic; call `sortVerses(verses, sort,
    now)` from the new lib.

**Files removed**: none.

### State changes

| State | Owner | Persisted |
|---|---|---|
| `masteredSort: SortOption` | Zustand + AsyncStorage (`@library_sort:mastered`) | Yes (device) |
| `inProgressSort: SortOption` | Zustand + AsyncStorage (`@library_sort:in-progress`) | Yes (device) — reserved for review-system |
| Per-collection `sortPreference` | DB column on `user_collections` | Yes (per-user, syncs across devices) |

`clear()` exempts the AsyncStorage sort keys. The DB column
naturally clears when the collection itself is deleted.

### UI

**Zero visual change** in this feature.

- The existing sort button (`Recent` / `A-Z` / `Mastery`) stays
  identical. The persisted value just survives navigation now.
- No new screens, no new components, no new icons.
- The new `due-first` enum value is rendered nowhere in this
  feature; review-system adds it to the cycle and supplies its
  label.

### Edge cases

- **Old client reading post-migration row**: SELECTs ignore unknown
  columns at the client level (Supabase JS returns the full row;
  the client only consumes fields it knows). Old client doesn't
  break.
- **New client reading pre-migration row**: `sort_preference` is
  undefined on the row → client defaults to `'recent'`. No crash.
- **User deletes a collection**: row is soft-deleted; sort
  preference dies with it. Re-adding a verse to a new collection
  starts fresh.
- **User changes sort, write to Supabase fails**:
  - Option: optimistically update Zustand, throw on Supabase
    failure, rollback. Matches the rest of the codebase.
  - Show a toast on failure ("couldn't save sort preference").
- **User on multiple devices changes sort on each at the same
  moment**: last write wins (existing pattern). Acceptable for a
  device-local-feeling preference.
- **User cycles the sort rapidly**: each tap = one Supabase UPDATE.
  Could debounce, but the writes are tiny; not worth complicating
  the path. Document as a known sharp edge.
- **Sort value in DB is unrecognized** (e.g. corrupted, or a future
  version of the app wrote a new value the current client doesn't
  know): client falls back to default. CHECK constraint at DB
  level prevents writing junk.

### What does NOT change

- Sort options themselves (Recent / A-Z / Mastery). New `due-first`
  enum reserved in the type but not added to the cycle UI.
- Filter preferences, search query, scroll position — none
  persisted.
- Verse-level state (mastery, progress, engraving) — untouched.
- Notification system — untouched.
- The Library list page itself — collections still display in DB
  insertion order; this feature only persists *sort within* a
  collection.

## Build order

Each chunk is a PR-sized commit that leaves the app in a working
state.

### Chunk 1 — Migration + types + storage layer

Branch: `library-sort-1-data`

Goal: schema migrated, type union exists, storage functions exist.
**No UI yet.**

Files:
- `supabase/migrations/0NN_collection_sort.sql` — see above.
- `lib/storage/index.ts` — `Collection.sortPreference?`,
  `getCollections()` mapping, new `updateCollectionSort`,
  `setMasteredSort` / `getMasteredSort`, `setInProgressSort` /
  `getInProgressSort`.
- `lib/store/library-sort.ts` — pure helpers.

Validation:
- `npx tsc --noEmit` clean.
- `npm run lint` clean.
- Apply migration locally: `supabase migration up` — manually
  inspect column with CHECK.

### Chunk 2 — Wire store + collection-detail screen

Branch: `library-sort-2-wire`

Goal: sort persists across navigation and app restart.

Files:
- `lib/store/index.ts` — `setCollectionSort` action,
  `useCollectionSort` selector, hydrate masteredSort from
  AsyncStorage alongside other settings, `clear()` exemption.
- `app/(tabs)/(library)/[id].tsx` — replace useState with the
  selector + action, replace inline sort with `sortVerses()`.

Validation: device test on iOS simulator:
- Open Truth → cycle to A-Z → navigate away → reopen → sort
  remembered.
- Open Mastered → cycle to Mastery → navigate away → reopen → sort
  remembered.
- Force-quit app → reopen → both still remembered.

### Chunk 3 — Doc graduation

Files:
- `docs/architecture/data-model.md` — note new
  `sort_preference` column on `user_collections`.
- `docs/architecture/library-and-collections.md` — add a "Sort"
  section documenting per-collection persistence and the
  AsyncStorage path for virtual collections.
- `docs/architecture/sync-and-storage.md` — add the new
  AsyncStorage keys and `clear()` exemptions to the table.
- `docs/features/library-sort-persistence.md` — flip status to
  `shipped`, fill in "What Was Built".

## Deployment sequencing

This feature is **safe to push at any time**, independently of the
review-system feature. The migration is purely additive:

- **Old client + new column**: SELECTs ignore unknown columns. The
  CHECK constraint never blocks because old clients can't write the
  new column. Old clients keep working.
- **New client + un-migrated DB**: SELECTs return rows without
  `sort_preference` → client falls back to default. Old defaults
  preserved.
- **No cleanup migration needed.** The column stays nullable
  forever; nothing to drop.

**Sequencing relative to review-system**:

This feature builds **after** `review-system` ships. Review-system
introduces the `due-first` sort option using the existing
non-persistent local-state pattern. Sort-persistence then makes
all sort options (including `due-first`) durable globally. No
ordering risk: review-system works correctly without sort
persistence (the sort just resets on navigation, matching today's
behavior); sort-persistence works correctly whether or not
`due-first` already exists in the cycle (it's just one more enum
value to handle).

Recommended order: ship review-system end-to-end first, then build
this feature as a separate planning + build cycle.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Per-collection sort, not global per-user | User explicitly preferred Spotify-style per-collection; small DB cost |
| 2026-04-27 | DB column for user collections, AsyncStorage for virtual collections | Mastered/In-Progress have no DB row; AsyncStorage matches existing device-pref pattern |
| 2026-04-27 | Migration is fully additive; no rollout-window concerns | Old clients ignore unknown columns; new clients tolerate missing column |
| 2026-04-28 | Build and ship after review-system | User preference for cleaner mental model: ship review-system as a focused feature first, then this as a self-contained follow-up. By the time this builds, `due-first` already exists in the sort cycle (from review-system); this feature just persists it. |

## Graduation Checklist

- [ ] Schema change reflected in `docs/architecture/data-model.md`
- [ ] Sort persistence reflected in `docs/architecture/library-and-collections.md`
- [ ] AsyncStorage keys + `clear()` exemptions reflected in `docs/architecture/sync-and-storage.md`

## What Was Built

(Filled when shipped.)
