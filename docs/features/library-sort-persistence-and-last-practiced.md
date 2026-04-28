# Feature: Per-Collection Sort Persistence + "Last Practiced" Recent

> **Status:** `planning`
> **Author:** Caelan
> **Created:** 2026-04-28
> **Shipped:** —
>
> **Supersedes / merges:** `docs/features/library-sort-persistence.md`
> (this doc rolls that feature in unchanged on the persistence axis,
> and adds the "Recent → Last Practiced" semantics change on top —
> they touch the same code paths, so building them together avoids
> two rounds of churn through `[id].tsx`).
>
> **Sibling docs:**
> - `docs/features/review-system.md` — already shipped. Added the
>   `due-first` sort cycle option for Mastered. This feature persists
>   it like every other option.
> - `docs/features/notification-system.md` — planned, separate; not
>   touched here.

## Problem

Two related but distinct problems in the Library experience today:

**Problem A — Sort doesn't stick.** Opening any collection in Library
resets the sort to `Recent` every time. The state is plain `useState`
in `app/(tabs)/(library)/[id].tsx:67`:

```ts
const [sortBy, setSortBy] = useState<SortOption>('recent');
```

A user who prefers viewing "Truth" alphabetically and "Mastered" by
mastery has to re-pick those sorts every navigation. Spotify-style
"the way I left this collection is how I find it next time" is the
target. The cost is small in isolation but felt every session, and
the `due-first` sort that review-system added to Mastered is
*especially* useless when it resets — that's the sort that
review-aware users would want as their default.

**Problem B — "Recent" means the wrong thing.** Today `Recent` sorts
by `createdAt` desc, i.e. order-of-addition. But when a user is
mid-flow with a collection they care about, the verses they actually
want at the top are the ones they've *practiced* recently — not the
ones they happened to add last. This is especially wrong for
"In Progress" (the new virtual collection from review-system), where
"Recent" today = "recently added" but the user's mental model is
"what am I actively working on." Renaming or repurposing this option
brings the cycle's behavior in line with intent across the app.

## Solution

Two changes shipped as one feature, because they touch the same
files and the same sort enum:

1. **Per-collection sort preference, persisted.** User collections
   store `sort_preference` on the DB row (syncs across devices).
   Virtual collections (Mastered, In Progress) store theirs in
   AsyncStorage (device-local, matches `colorMode` /
   `bibleVersion` pattern).

2. **"Recent" means "Last Practiced".** Replace the `recent` sort's
   compare function from `b.createdAt - a.createdAt` to a new
   `lastPracticedAt`-based ordering, applied uniformly to all
   collections. Verses never practiced fall back to `createdAt` so
   first-time users see the same order they do today.

The sort cycle keeps the same options (Recent, A–Z, Mastery; plus
Due First on Mastered). Only the meaning of `recent` changes.

## Requirements

### Must have

- [ ] `user_collections.sort_preference TEXT NULL` column added by
      additive migration. CHECK includes all current and reserved
      enum values (`recent`, `alphabetical`, `mastery`, `due-first`).
- [ ] `user_verses.last_practiced_at TIMESTAMPTZ NULL` column added
      by the same migration. Updated on every session completion
      (full or partial), regardless of whether the score is a new
      best.
- [ ] Each user collection's sort persists across app close/reopen,
      device restart, and re-sign-in.
- [ ] Mastered + In Progress sort persists across the same.
- [ ] User-collection sort syncs across devices (DB row); virtual
      collections sort is device-local (AsyncStorage).
- [ ] Default sort is `recent` for every collection EXCEPT
      Mastered, which defaults to `due-first` (review-aware default;
      user can cycle to anything else and it persists).
- [ ] Cycle pill keeps the existing `Recent` label even though its
      meaning changes. No copy change.
- [ ] `recent` ordering: `lastPracticedAt` desc among practiced
      verses, then `createdAt` desc among never-practiced verses.
      Never-practiced verses sort *after* practiced ones.
- [ ] No backfill at migration time — `last_practiced_at` starts
      NULL for every existing row and populates organically as
      users practice. Day-one ordering is identical to today's
      `createdAt`-desc behavior, then verses float as they're
      practiced.
- [ ] Last-practiced timestamp updates even when a session score
      is neither a new best nor a qualifying review — practicing
      always floats the verse.
- [ ] Old client tolerates the new columns (Supabase JS ignores
      unknown columns on read; existing UPDATEs don't reference the
      new columns).
- [ ] New client tolerates an unmigrated DB (column missing → row
      shape lacks the field → falls back to `createdAt` for sort,
      falls back to default sort).

### Nice to have

(none — original "Last practiced 3d ago" subtitle moved to
out-of-scope below for clarity.)

### Explicitly out of scope

- Per-collection *filter* preferences. Sort only.
- Cross-device sync of virtual-collection sorts (intentional:
  device-local matches existing pattern).
- Historical sort preferences. Single value per collection.
- Per-user default sort (e.g. "make A-Z my default everywhere").
- Any backfill of `last_practiced_at` — column starts NULL for all
  existing rows, populates organically.
- **Per-(verse, collection) ordering.** A verse in 4 collections
  has *one* `last_practiced_at`; practicing it floats it in all
  four. Per-collection ordering was investigated and deferred —
  see Decisions Log entry 2026-04-28 for the analysis. The future
  migration to per-collection is purely additive (new column on
  `verse_collections`, fall back to verse-level when NULL), so we
  are not painting into a corner.
- Reordering of collections themselves on the Library list page.
- Changing the cycle order or adding new sort options beyond what
  exists today.
- Renaming the "Recent" cycle pill — the label stays "Recent" even
  though its meaning is now last-practiced.
- Showing "Last practiced 3d ago" subtitles on verse cards (was a
  nice-to-have; deferred to a follow-up if users find the silent
  semantic change confusing).
- Touching the notification-system planning doc.

## Resolved Decisions

All open questions resolved on 2026-04-28. Originals preserved in
git history.

| # | Decision | Reasoning |
|---|---|---|
| Q1 | Default sort is **`recent`** for every collection EXCEPT **Mastered**, which defaults to **`due-first`**. | Mastered is the review-aware collection — `due-first` is the most useful first-load view. Other collections stay on `recent`. Implemented as a different Zustand initial value for `masteredSort`; hydrate overwrites with AsyncStorage if the user has saved a different choice. *(Originally resolved 2026-04-28 as "always `recent`" — flipped after user testing the persistence layer; cycling to `due-first` once and having it stick is the same end state, but day-one users get the better default.)* |
| Q2 | Cycle pill **keeps the "Recent" label**. No copy change. | Behavior change is the point; the label "Recent" is short and serviceable. If users find the silent change confusing, a follow-up adds a "Last practiced 3d ago" card subtitle. |
| Q3 | Never-practiced verses sort **after** practiced ones, by `createdAt` desc among themselves. | "Recently practiced floats" is the model; new untried verses queue below. |
| Q4 | **No backfill.** `last_practiced_at` starts NULL for all existing rows; populates organically. | User explicit pref: day-one shows today's order, verses float as practiced. Avoids the cost/risk of a join-backfill in the migration. |
| Q5 | Bump via **`updateVerseProgress` always writing `last_practiced_at`**, even when progress is otherwise unchanged. | Smallest change. One Supabase UPDATE per session instead of two (no separate touch call). Atomicity isn't critical: a failure means a verse doesn't float, not corruption. The Postgres-function alternative (`record_session`) is cleaner but adds a SECURITY DEFINER function and migration weight that aren't earning their keep here. |
| — | **Per-verse, not per-(verse, collection)** `last_practiced_at`. A verse in N collections shares one timestamp; practicing it floats it in all N. | Investigated by a planning agent on 2026-04-28. Per-collection would require (a) plumbing `collectionId` through library list → setup route → session route → study hook → write paths (4 files of churn), (b) a hybrid scheme because Mastered/In Progress have no junction rows, (c) lose the timestamp on soft-delete-and-restore. Migration to per-collection later is purely additive (new column on `verse_collections`, fall back to verse-level when NULL), so we're not painting into a corner. |

## Technical Approach

### Data model changes

**One new migration**: `supabase/migrations/016_sort_and_last_practiced.sql`.
Adds two nullable columns and one index. No backfill, no new
functions.

```sql
-- 016_sort_and_last_practiced.sql

-- Per-collection sort preference. Nullable so existing rows default
-- to client-side default sort. Old clients tolerate unknown columns
-- on SELECT.
ALTER TABLE public.user_collections
ADD COLUMN sort_preference TEXT NULL
CHECK (sort_preference IN ('recent', 'alphabetical', 'mastery', 'due-first'));

COMMENT ON COLUMN public.user_collections.sort_preference IS
'Per-collection sort. NULL = client default. due-first applies to Mastered only.';

-- Last time the user practiced (completed any session, full or
-- partial) on this verse. Used for the "Recent" sort, which now
-- means "last practiced descending" rather than "added descending".
-- Starts NULL for all rows; populates organically as users practice.
ALTER TABLE public.user_verses
ADD COLUMN last_practiced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.user_verses.last_practiced_at IS
'Updated whenever updateVerseProgress runs for any session completion (full or partial). NULL means never practiced — sorts after practiced verses under the Recent comparator.';

-- No index. Sorting happens client-side in JS on the in-memory
-- verses array (server queries order by added_at / updated_at,
-- not last_practiced_at). An index would be dead weight that
-- costs write IO on every progress update without read benefit.
-- If we ever move to server-side ORDER BY, add the index then.
```

**No RLS changes.** `sort_preference` lives on existing
`user_collections` rows; existing policies cover it.
`last_practiced_at` lives on existing `user_verses` rows; existing
policies cover it.

**Atomicity.** `updateVerseProgress` writes `last_practiced_at`
and `progress` in the same `UPDATE` (one statement, atomic at the
row level). `logSessionAttempt` remains a separate fire-and-forget
INSERT — if it fails, the verse still floats correctly and the
analytics row is just lost (same drop-on-failure semantics as
today). The two writes are not co-atomic and don't need to be:
"Recent" sort doesn't depend on `session_attempts` rows existing.

### Sync impact

Adds two field reads and two new write paths:

- **Read**: `getCollections()` selects `sort_preference`;
  `getSavedVerses()` selects `last_practiced_at`. Both add one
  column to the existing query — no extra fetch.
- **Write (sort)**: new `updateCollectionSort(id, sort)` storage
  function calls
  `supabase.from('user_collections').update({ sort_preference })`.
- **Write (last_practiced)**: `lib/store/index.ts:736
  updateVerseProgress` is patched to always write
  `last_practiced_at: new Date().toISOString()` in its UPDATE,
  even when neither `isNewBest` nor `isQualifyingReview`. The
  current early-return guard
  (`if (!isNewBest && !isQualifyingReview) return;`) is replaced
  by a guard that still writes the timestamp before returning.
- **Multi-device note**: `last_practiced_at` is last-write-wins
  (same model as `progress`). If two devices end sessions on the
  same verse seconds apart, the later one wins; fine for sort
  semantics.

### Cache impact

**None.** Verse text caching is unaffected. The Bible session
cache, `verse_cache` table, and KJV bundle short-circuit are all
orthogonal.

### Client changes

**Files added**:

- `lib/store/library-sort.ts` — pure helpers:
  - `type SortOption = 'recent' | 'alphabetical' | 'mastery' | 'due-first'`
  - `DEFAULT_SORT: SortOption = 'recent'`
  - `cycleSort(current: SortOption, isMastered: boolean): SortOption`
    — preserves today's cycle: `recent → alphabetical → mastery →
    (isMastered ? 'due-first' : 'recent') → recent`.
  - `getSortLabel(s: SortOption): string` — returns "Recent" /
    "A–Z" / "Mastery" / "Due first". (Q2 resolved: keep "Recent".)
  - `sortVerses(verses: SavedVerse[], sort: SortOption, now: Date): SavedVerse[]`
    — lifted out of `[id].tsx`. Takes explicit `now` so callers
    can use `useReviewNow()` for `due-first`. **All four
    comparators must be preserved exactly, including the
    `due-first` `createdAt` tiebreaker which is easy to drop.**
    Concrete shape:
    ```ts
    export function sortVerses(
      verses: SavedVerse[],
      sort: SortOption,
      now: Date,
    ): SavedVerse[] {
      const sorted = [...verses];
      switch (sort) {
        case 'alphabetical':
          return sorted.sort((a, b) =>
            formatVerseReference(a).localeCompare(formatVerseReference(b))
          );
        case 'mastery': {
          const level = (v: SavedVerse) => {
            if (v.progress.engraved?.completed) return 4;
            if (v.progress.hard.completed) return 3;
            if (v.progress.medium.completed) return 2;
            if (v.progress.easy.completed) return 1;
            return 0;
          };
          return sorted.sort((a, b) => level(b) - level(a));
        }
        case 'due-first':
          return sorted.sort((a, b) => {
            const da = daysUntilDue(a, now);
            const db = daysUntilDue(b, now);
            if (da !== db) return da - db;
            return b.createdAt - a.createdAt; // tiebreaker — keep
          });
        case 'recent':
        default:
          // Q3 resolved: never-practiced sort AFTER practiced, by
          // createdAt desc among themselves.
          return sorted.sort((a, b) => {
            const la = a.lastPracticedAt ? Date.parse(a.lastPracticedAt) : null;
            const lb = b.lastPracticedAt ? Date.parse(b.lastPracticedAt) : null;
            if (la !== null && lb !== null) return lb - la;
            if (la !== null) return -1;
            if (lb !== null) return 1;
            return b.createdAt - a.createdAt;
          });
      }
    }
    ```

**Files modified**:

- `supabase/migrations/016_sort_and_last_practiced.sql` — new
  (above).
- `lib/storage/index.ts`:
  - `Collection` type: add `sortPreference?: SortOption`.
  - `SavedVerse` type: add `lastPracticedAt?: string` (ISO).
  - `getCollections()`: select `sort_preference`, map to
    `sortPreference` on the return shape.
  - `getSavedVerses()`: select `last_practiced_at` from the
    `user_verses!inner(*)` join, map to `lastPracticedAt`.
  - `getMasteredVerses()`: same — select and map.
  - New `updateCollectionSort(id, sort)`:
    `supabase.from('user_collections').update({ sort_preference: sort }).eq('client_id', id)`.
  - New `setMasteredSort` / `getMasteredSort` and
    `setInProgressSort` / `getInProgressSort` helpers backed by
    AsyncStorage keys `library_sort_mastered` and
    `library_sort_in_progress` (snake_case to match the existing
    `app_color_mode` / `app_bible_version` /
    `review_max_interval_days` convention — no `@` prefix, no
    colons).
- `lib/store/index.ts`:
  - **`fetchCollections` (inline supabase query, line 144)**: add
    `sort_preference` to the `select(...)` and map to
    `sortPreference` on the result objects. The storage-layer
    edit is parallel — both code paths populate Zustand on
    different lifecycle events (hydrate vs targeted refresh), so
    both need the column.
  - **`fetchVerses` (inline supabase query, line 188)**: add
    `last_practiced_at` to the `user_verses!inner(*)` select and
    map to `lastPracticedAt` on each row.
  - **`fetchMasteredVerses` (inline supabase query, line 233)**:
    same — add to the select and the row mapper. Without this,
    the Mastered collection's "Recent" sort sees `lastPracticedAt
    === undefined` for every row until the user practices a
    mastered verse.
  - Add `setCollectionSort(collectionId, sort)` action. Routing
    is **by collection ID, not by `isVirtual`**:
    ```ts
    if (collectionId === MASTERED_COLLECTION_ID)         → setMasteredSort
    if (collectionId === IN_PROGRESS_COLLECTION_ID)      → setInProgressSort
    else                                                  → updateCollectionSort
    ```
    Virtual-collection objects in `state.collections` don't carry
    a `sortPreference` field; the route key is the ID literal.
  - Hydrate loads `masteredSort` and `inProgressSort` from
    AsyncStorage in the same `Promise.all` that already loads
    `colorMode` / `bibleVersion` / `reviewMaxIntervalDays`.
  - `clear()` does NOT touch AsyncStorage (the function only
    resets Zustand). The requirement is to **omit `masteredSort`
    and `inProgressSort` from the `set(...)` call** so the
    Zustand mirrors of those values survive the in-memory wipe
    between sign-out and re-hydrate (matching the existing
    `colorMode` / `bibleVersion` / `reviewMaxIntervalDays`
    pattern called out in `sync-and-storage.md` invariant #6).
  - Add selector `useCollectionSort(collectionId)` — routes
    by ID literal:
    ```ts
    if (collectionId === MASTERED_COLLECTION_ID)    → state.masteredSort
    if (collectionId === IN_PROGRESS_COLLECTION_ID) → state.inProgressSort
    else  → state.collections.find(c => c.id === id)?.sortPreference
    ```
    Falls back to `DEFAULT_SORT = 'recent'` when undefined. Mastered's
    default is encoded as the **initial Zustand value**
    (`masteredSort: 'due-first'` instead of `DEFAULT_SORT`); hydrate
    overwrites with the AsyncStorage value if the user has saved one.
  - Patch `updateVerseProgress`. The current function has a hard
    early-return at line 755:
    ```ts
    if (!isNewBest && !isQualifyingReview) return;
    ```
    The patched function must (a) bump the timestamp on every
    completed session, (b) preserve the existing happy-path when
    progress changes, and (c) keep the optimistic Zustand update
    consistent with both branches. Concrete shape:

    ```ts
    updateVerseProgress: async (id, difficulty, accuracy, fullSession = false) => {
      const verse = get().verses.find((v) => v.id === id);
      if (!verse) return;

      const currentBest = verse.progress[difficulty]?.bestAccuracy;
      const isNewBest = currentBest === null || accuracy > currentBest;
      const isQualifyingReview = difficulty === 'hard' && accuracy >= 90 && fullSession;
      const nowIso = new Date().toISOString();

      // Build the UPDATE shape. last_practiced_at always present;
      // progress only when something actually changed.
      const updateShape: { last_practiced_at: string; progress?: any } = {
        last_practiced_at: nowIso,
      };

      let newProgress = verse.progress;
      let justBecameMastered = false;

      if (isNewBest || isQualifyingReview) {
        newProgress = { ...verse.progress };
        if (isNewBest) {
          newProgress[difficulty] = { bestAccuracy: accuracy, completed: accuracy >= 90 };
        }
        if (isQualifyingReview) {
          const prevEngraved = newProgress.engraved ?? DEFAULT_PROGRESS.engraved!;
          newProgress.engraved = computeNextSrState(
            prevEngraved, accuracy, difficulty, fullSession, new Date(),
            get().reviewMaxIntervalDays,
          );
        }
        updateShape.progress = newProgress;
        justBecameMastered = !!(newProgress.hard?.completed && !verse.progress.hard?.completed);
      }

      const { error } = await supabase
        .from('user_verses')
        .update(updateShape)
        .eq('client_id', id);

      if (error) {
        console.error('[STORE] Failed to update progress:', error);
        throw new Error('Failed to save progress');
      }

      set((state) => {
        const updatedVerses = state.verses.map((v) =>
          v.id === id ? { ...v, progress: newProgress, lastPracticedAt: nowIso } : v
        );
        let updatedMastered = state.masteredVerses;
        if (justBecameMastered) {
          updatedMastered = [
            { ...verse, progress: newProgress, lastPracticedAt: nowIso, collectionId: MASTERED_COLLECTION_ID },
            ...state.masteredVerses,
          ];
        } else {
          updatedMastered = state.masteredVerses.map((v) =>
            v.id === id ? { ...v, progress: newProgress, lastPracticedAt: nowIso } : v
          );
        }
        return { verses: updatedVerses, masteredVerses: updatedMastered };
      });
    },
    ```

    Notes:
    - The verse-membership shape (one entry per junction in
      `verses[]`) means the `v.id === id ? ...` mapper updates
      *every* row for that verse across all its collections. This
      is correct — `lastPracticedAt` is verse-level, not
      junction-level (per the per-verse decision).
    - The `set(...)` always runs, even in the timestamp-only
      branch. Without it the user's screen wouldn't reflect the
      bump until next refetch.

  - Patch `resetVerseProgress` (line 819) to also clear
    `last_practiced_at`:
    - Server UPDATE: `update({ progress: DEFAULT_PROGRESS, last_practiced_at: null })`.
    - Optimistic update: spread `lastPracticedAt: undefined`
      (or omit) onto both arrays.
    - Reasoning: a reset verse with a stale `last_practiced_at`
      would still float under "Recent" — surprising for the user
      who just nuked its progress.
- `app/(tabs)/(library)/[id].tsx`:
  - Replace `useState<SortOption>('recent')` with
    `useCollectionSort(id)` selector + `setCollectionSort` action.
  - Replace inline sort with `sortVerses(filteredVerses, sortBy, now)`.
  - `cycleSortBy()` calls the action instead of `setSortBy`.
  - `getSortLabel()` is removed — uses the helper from
    `library-sort.ts`.

**Files removed**: none.

**Files NOT touched (intentional):** `lib/api/analytics.ts`,
`hooks/use-study-session.ts`. The `record_session` RPC path was
considered (would have collapsed `logSessionAttempt` +
`updateVerseProgress` into one call) and rejected — see Q5
decision. The current two-call pattern stays.

### State changes

| State | Owner | Persisted |
|---|---|---|
| `masteredSort: SortOption` | Zustand + AsyncStorage (`library_sort_mastered`) | Yes (device) |
| `inProgressSort: SortOption` | Zustand + AsyncStorage (`library_sort_in_progress`) | Yes (device) |
| Per-collection `sortPreference` | DB column on `user_collections` | Yes (per-user, syncs) |
| Per-verse `lastPracticedAt` | DB column on `user_verses`, mirrored on `SavedVerse` in Zustand | Yes (per-user, syncs) |

`clear()` doesn't touch AsyncStorage at all — the AsyncStorage
copies of the sort keys naturally survive sign-out. The Zustand
mirrors `masteredSort` / `inProgressSort` are kept across
sign-out by being omitted from `clear()`'s `set(...)` call (same
mechanism as `colorMode` / `bibleVersion`).

### UI

**Zero new screens / modals / icons.**

- The existing sort button cycles through the same set with the
  same labels. The "Recent" option's *meaning* changes (now
  last-practiced) but its label is unchanged. No copy update.
- No visual treatment of `lastPracticedAt` itself in this PR.
  Deferred follow-up could add "Last practiced 3d ago" subtitles
  to verse cards if the silent semantic change confuses users.
- The Recent sort comparator changes; verses re-order on the next
  navigation into the collection. No animated transition needed.

### Edge cases

- **Old client reading post-migration row**: SELECTs return rows
  including the new columns; old client ignores unknown fields.
  No crash, no functional change.
- **New client reading pre-migration row**: `sort_preference` and
  `last_practiced_at` are undefined → client falls back to default
  sort, treats NULL `lastPracticedAt` per Q3.
- **Verse practiced offline**: session attempt is silently lost
  today (CLAUDE.md invariant 10). `last_practiced_at` likewise
  doesn't update for that session. **No new offline-loss
  problem** — same shape as today.
- **Verse soft-deleted between session start and end (multi-device
  scenario)**: the UPDATE in `updateVerseProgress` filters by
  `client_id` (no `deleted_at` filter today); the bump lands on
  the soft-deleted row, which is harmless — sort lookups already
  exclude soft-deleted rows.
- **User on multiple devices changes sort on each at the same
  moment**: last-write-wins on `sort_preference`. Acceptable for
  a UI preference.
- **User cycles sort rapidly**: each tap = one Supabase UPDATE.
  Tiny, not worth debouncing.
- **Sort value in DB is unrecognized** (corruption / future
  client writes a value the current client doesn't know): client
  falls back to default. CHECK constraint prevents writing junk
  from current clients.
- **In Progress collection hidden when count = 0**: the persisted
  sort still survives in AsyncStorage. When verses are added back
  and the collection re-appears, the sort is restored.
- **Day-one ordering with NULL backfill**: every existing row has
  `last_practiced_at IS NULL`, so on first launch every collection
  falls into the "neither practiced" branch of the comparator and
  sorts by `createdAt` desc — identical to today. As users
  practice, those verses float; never-practiced verses settle to
  the bottom. Intentional ramp-in.
- **Verse in N collections, practiced from one**: timestamp is
  per-verse, so practicing it in Truth floats it under "Recent" in
  every collection it belongs to, including Mastered (if mastered)
  and In Progress (if in-progress). Documented behavior, not a bug.
  See Q5 / per-collection deferral above.

### What does NOT change

- Sort cycle order (Recent → A-Z → Mastery → Due First on
  Mastered, Recent → A-Z → Mastery → Recent elsewhere).
- The Mastery sort comparator (engraved > hard > medium > easy >
  none).
- The A–Z sort comparator (`localeCompare` on the formatted ref).
- The Due First sort comparator (asc by `daysUntilDue`, with
  `createdAt` desc tiebreaker — preserved by the new
  `sortVerses` helper).
- Server-side ORDER BY in `getSavedVerses` / `fetchVerses` /
  `fetchMasteredVerses` — those still return rows ordered by
  `added_at` / `updated_at`. Sorting by "Recent" happens in JS
  on the in-memory array. (Why we don't add a DB index on
  `last_practiced_at`.)
- Filter / search / scroll position — none persisted (out of
  scope).
- Verse-level state (mastery, progress, engraving) — untouched.
- Notification system — untouched.
- The Library list page itself — collections still show in DB
  insertion order.
- Bible verse fetching, caching, KJV bundle short-circuit —
  orthogonal.
- Edge functions — none called.

## Build order

Each chunk is a PR-sized commit that leaves the app in a working
state.

### Chunk 1 — Migration + types + storage layer

Branch: `library-sort-1-data`

Goal: schema migrated, type fields exist, storage helpers exist.
**No UI yet.**

Files:
- `supabase/migrations/016_sort_and_last_practiced.sql` — new
  (full SQL above).
- `lib/storage/index.ts`:
  - `Collection.sortPreference?` field.
  - `SavedVerse.lastPracticedAt?` field.
  - `getCollections()` — select `sort_preference`, map.
  - `getSavedVerses()` — select `last_practiced_at`, map.
  - `getMasteredVerses()` — select `last_practiced_at`, map.
  - `updateCollectionSort`, `setMasteredSort` /
    `getMasteredSort`, `setInProgressSort` /
    `getInProgressSort`.
- `lib/store/index.ts` — **all four read sites** (parallel to
  the storage-layer code; both populate Zustand on different
  triggers):
  - `fetchCollections` (inline supabase) — select + map
    `sort_preference`.
  - `fetchVerses` (inline supabase) — select + map
    `last_practiced_at`.
  - `fetchMasteredVerses` (inline supabase) — select + map
    `last_practiced_at`.
- `lib/store/library-sort.ts` — pure helpers
  (`SortOption`, `DEFAULT_SORT`, `cycleSort`, `getSortLabel`,
  `sortVerses`). Full code in "Client changes" above.

Validation:
- `npx tsc --noEmit` clean.
- `npm run lint` clean.
- Apply migration locally: `supabase migration up` — manually
  inspect both new columns and the index.
- Confirm `last_practiced_at` is NULL for every existing row
  (`SELECT count(*) FROM user_verses WHERE last_practiced_at IS NOT NULL;`
  → 0). No backfill is intended.

### Chunk 2 — Wire store + collection-detail screen

Branch: `library-sort-2-wire`

Goal: sort persists across navigation and app restart. Recent
sort uses `lastPracticedAt`.

Files:
- `lib/store/index.ts`:
  - `setCollectionSort` action — ID-routed (see Client changes).
  - `useCollectionSort` selector — ID-routed, defaults to
    `'recent'`.
  - Hydrate loads `masteredSort` + `inProgressSort` alongside
    other settings.
  - `clear()`'s `set(...)` call omits `masteredSort` and
    `inProgressSort` so they survive sign-out (matching the
    existing pattern for `colorMode` / `bibleVersion` /
    `reviewMaxIntervalDays`).
- `app/(tabs)/(library)/[id].tsx`:
  - Replace `useState` with selector + action.
  - Replace inline sort with `sortVerses(...)`.

> **Important**: Chunk 2 alone is **user-facing no-op** without
> Chunk 3. The "Recent" comparator falls into the
> "neither-practiced" branch for every row (because nothing has
> bumped `last_practiced_at` yet), so the visible order is
> `createdAt` desc — identical to today. The behavior change only
> kicks in once Chunk 3 ships. Don't ship Chunk 2 alone for
> a long window or it looks like nothing happened.

Validation: device test on iOS simulator:
- Open Truth → cycle to A-Z → navigate away → reopen → A-Z
  remembered.
- Open Mastered → cycle to Mastery → navigate away → reopen →
  Mastery remembered.
- Force-quit app → reopen → both still remembered.
- Verses with recent practice rise to the top under "Recent".
- Brand-new collection (no practice) keeps `createdAt` order
  under "Recent".

### Chunk 3 — Last-practiced bump on session completion

Branch: `library-sort-3-bump`

Goal: completing a session bumps `last_practiced_at` so the next
"Recent" sort reflects it.

Files:
- `lib/store/index.ts`:
  - Patch `updateVerseProgress` per the full code block in
    "Client changes" above. Two-shape UPDATE (timestamp-only or
    timestamp + progress); optimistic `set(...)` always runs and
    mirrors the timestamp on both `verses` and `masteredVerses`.
  - Patch `resetVerseProgress` to also clear
    `last_practiced_at` (server UPDATE + optimistic mirror).

Validation:
- Complete a session on any verse → reopen the collection →
  that verse is at the top under "Recent".
- Complete a partial session (save & exit) → same result.
- Complete a low-accuracy session that doesn't change progress
  → that verse still moves to the top under "Recent" (this is
  the behavior change vs today's short-circuit).
- Reset a verse's progress from the verse detail page → that
  verse drops to the bottom of "Recent" (its
  `lastPracticedAt` was cleared).
- Practice a verse that lives in 4 collections → it floats to
  the top under "Recent" in all 4 (per-verse semantics).

### Chunk 4 — Doc graduation

Files:
- `docs/architecture/data-model.md` — note the two new columns
  (`user_collections.sort_preference`,
  `user_verses.last_practiced_at`) and the new index.
- `docs/architecture/library-and-collections.md` — replace the
  "Sorting" section with: per-collection persistence + "Recent =
  last practiced (with createdAt fallback)" semantics +
  AsyncStorage path for virtual collections. Note that the same
  timestamp drives sort across every collection a verse lives in.
- `docs/architecture/sync-and-storage.md` — add the new
  AsyncStorage keys and `clear()` exemptions to the table; add
  the new field to the "What lives where" table.
- `docs/features/library-sort-persistence.md` — mark
  superseded; point at this doc.
- `docs/features/library-sort-persistence-and-last-practiced.md`
  — flip status to `shipped`, fill in "What Was Built".

## Migration safety

This migration is **safe to push at any time**, independently of
any other in-flight feature. It is purely additive at the schema
level.

- **Old client + new columns**: SELECTs return rows including the
  new columns; the client only consumes fields it knows. CHECK
  constraint never triggers because old clients can't write the
  new column. No-op for old clients.
- **New client + un-migrated DB**: SELECTs return rows without the
  new fields; client falls back to defaults. No crash.
- **No cleanup migration needed** — both columns stay nullable
  forever.

**No backfill, no migration cost beyond DDL.** Both ALTERs are
nullable column adds (instant) and one CHECK on
`user_collections.sort_preference` (validated against the
existing column values, all NULL at add time, so no rewrite). No
indexes are created — sorting is client-side only.

Day-one ordering with NULL-everywhere matches today's behavior
exactly (everything falls back to `createdAt`), so there is no
visible "before/after" jolt at the moment of migration.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Per-collection sort, not global per-user | User explicitly preferred Spotify-style per-collection; small DB cost |
| 2026-04-27 | DB column for user collections, AsyncStorage for virtual collections | Mastered/In-Progress have no DB row; AsyncStorage matches existing device-pref pattern |
| 2026-04-27 | Migration is fully additive; no rollout-window concerns | Old clients ignore unknown columns; new clients tolerate missing column |
| 2026-04-28 | Build and ship after review-system | Review-system already shipped; persistence + semantics layer cleanly on top |
| 2026-04-28 | Merge sort-persistence and "Recent = last practiced" into one feature | They touch the same enum, the same comparator function, and the same screen — building together avoids two rounds of churn |
| 2026-04-28 | Denormalize `last_practiced_at` on `user_verses` | The alternative (join `session_attempts` on every Library render) is too expensive; the in-memory-only `engraved.lastReviewedAt` doesn't cover non-mastered verses, which is exactly when "last practiced" is most useful (In Progress) |
| 2026-04-28 | Q1 — Default sort is `recent` everywhere EXCEPT Mastered, which defaults to `due-first` | Mastered is review-aware; due-first is the most useful day-one view. Other collections stay on recent. Originally resolved as "always recent" — flipped during build after seeing the cycle work end-to-end. |
| 2026-04-28 | Q2 — Keep "Recent" label on the cycle pill | Behavior change is the point; label is short and serviceable. Follow-up adds card subtitles if the silent change confuses users. |
| 2026-04-28 | Q3 — Never-practiced verses sort after practiced ones, by `createdAt` desc | Matches "recently practiced floats" mental model. New untried verses queue below. |
| 2026-04-28 | Q4 — No backfill; `last_practiced_at` starts NULL | User explicit pref. Day-one shows today's order; verses float as practiced. Avoids cost/risk of join-backfill in migration. |
| 2026-04-28 | Q5 — Bump via `updateVerseProgress` always writing the timestamp; no `record_session` Postgres fn | Smallest change. One UPDATE per session. Atomicity not critical: failure means a verse doesn't float, not corruption. |
| 2026-04-28 | Per-verse `last_practiced_at`, not per-(verse, collection) | Investigated by planning agent. Per-collection would (a) thread `collectionId` through 4 files in study loop, (b) need a hybrid scheme because Mastered/In Progress have no junction rows, (c) lose timestamp on soft-delete-and-restore. Future migration to per-collection is purely additive — not painted into a corner. |

## Graduation Checklist

- [ ] Schema changes reflected in `docs/architecture/data-model.md`
- [ ] Sort persistence + "Recent = last practiced" reflected in
      `docs/architecture/library-and-collections.md`
- [ ] AsyncStorage keys + `clear()` exemptions reflected in
      `docs/architecture/sync-and-storage.md`
- [ ] Old `docs/features/library-sort-persistence.md` marked
      superseded

## What Was Built

(Filled when shipped.)
