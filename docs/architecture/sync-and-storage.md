# Sync and Storage

The app's storage strategy is **server-of-record, in-memory state,
no offline writes**. Supabase is the source of truth for all user
data. Zustand holds the current view of that data in memory.
AsyncStorage holds device settings and small local caches.

## What lives where

| Data | Server (Supabase) | Zustand (in-memory) | AsyncStorage |
|---|:-:|:-:|:-:|
| Collections | ✓ | ✓ | — |
| Verses | ✓ | ✓ | — |
| Mastered verses (incl. soft-deleted) | ✓ | ✓ | — |
| Session attempts | ✓ (append) | — | — |
| Verse text | ✓ (`verse_cache`) | session cache (`lib/cache/`) | — |
| `colorMode` | — | ✓ | ✓ (`app_color_mode`) |
| `bibleVersion` | — | ✓ | ✓ (`app_bible_version`) |
| `reviewMaxIntervalDays` | — | ✓ | ✓ (`review_max_interval_days`) |
| Virtual collection sorts | — | ✓ | ✓ (`library_sort_mastered`, `library_sort_in_progress`) |
| Other collections' sort | ✓ (`sort_preference`) | ✓ | — |
| Notification prefs | ✓ | ✓ (`usePrefsStore`) | ✓ cache (`notifications_prefs_cache`) |
| Notification flags, push token | — | ✓ (`useUxFlagsStore`, flags) | ✓ (`notifications_q1_dismissed`, `notifications_settings_visited`, `notifications_cached_expo_token`) |
| Auth session | — | (via Supabase) | ✓ (Supabase-managed) |
| Migration flag | — | — | `data_synced_to_server`, only set by unused code in `lib/sync/migration.ts` |

**Verses, collections and progress are never persisted to
AsyncStorage.** The app does not work offline for writes — see the
offline section below.

## Zustand store

`lib/store/index.ts`. The store is built with `zustand` (no
`persist` middleware; settings and virtual-collection sorts are
written to AsyncStorage manually).

### Shape

```ts
interface AppState {
  // Data (in-memory only)
  collections: Collection[];
  verses: SavedVerse[];
  masteredVerses: SavedVerse[];

  // Settings (also in AsyncStorage)
  colorMode: 'system' | 'light' | 'dark';
  bibleVersion: BibleVersion;
  reviewMaxIntervalDays: number;
  masteredSort: SortOption;
  inProgressSort: SortOption;

  // Lifecycle flags
  hydrated: boolean;
  collectionsLoading: boolean;
  versesLoading: boolean;
  masteredLoading: boolean;
  error: string | null;

  // Actions
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  fetchCollections: () => Promise<boolean>;
  fetchVerses: () => Promise<boolean>;
  fetchMasteredVerses: () => Promise<boolean>;
  setColorMode: (mode) => Promise<void>;
  setBibleVersion: (v) => Promise<void>;
  setReviewMaxIntervalDays: (days) => Promise<void>;
  addCollection: (name) => Promise<Collection>;
  deleteCollection: (id) => Promise<void>;
  setCollectionSort: (collectionId, sort) => Promise<void>;
  addVerse: (verse, collectionId, version) => Promise<SavedVerse>;
  deleteVerse: (id, collectionId) => Promise<{ wasMastered: boolean }>;
  updateVerseProgress: (id, difficulty, accuracy, fullSession?) => Promise<void>;
  resetVerseProgress: (id) => Promise<void>;
  setVerseStudyPrefs: (id, chunkSize, difficulty) => void;
  clear: () => void;
}
```

### Selectors

The convention is `useX(...)` selectors, not direct
`useAppStore(...)` calls in components:

| Selector | Returns |
|---|---|
| `useCollections()`, `useCollection(id)` | `Collection[]`, one collection |
| `useCollectionSort(id)` | the collection's `SortOption` |
| `useVerses()` | `SavedVerse[]` |
| `useHydrated()`, `useStoreError()` | `boolean`, `string \| null` |
| `useVerse(id)` | one verse from `verses` or `masteredVerses` |
| `useVersesByCollection(id)`, `useCollectionVerseCount(id)` | filtered verse list, its length |
| `useMasteredVerses()`, `useMasteredVerseCount()` | `masteredVerses`, its count |
| `useInProgressVerses()`, `useInProgressVerseCount()` | the virtual In Progress list, its count |
| `useReviewMaxIntervalDays()`, `useReviewState(id)`, `useDueCounts()` | review state, see `docs/features/review.md` |
| `useMostMemorizedBooks()` | top 5 books by mastered count |
| `useInsightsStats()` | `{ versesMastered, inProgress }` |

### Persistence

- Settings and virtual-collection sorts are written to AsyncStorage
  in their setters (manually, not via `persist` middleware).
- All other state is in-memory only. On app restart it's empty
  until `hydrate()` runs.

### `clear()`

Wipes user data on sign-out. Device-level prefs (`colorMode`,
`bibleVersion`, `reviewMaxIntervalDays`, `masteredSort`,
`inProgressSort`) are **preserved by omission** — `clear()` calls
`set(...)` listing only the data and loading-state keys, and Zustand
keeps everything else. If you add another device-level pref, just
don't list it in `clear()`'s `set`.

## Hydration

Called by an effect in `app/_layout.tsx` when `isAuthenticated` goes
true.

```
hydrate()
  ├── Promise.all(AsyncStorage reads for colorMode, bibleVersion,
  │                reviewMaxIntervalDays, masteredSort, inProgressSort)
  │     → set in store, after validating each value
  │
  ├── Promise.all(fetchCollections, fetchVerses, fetchMasteredVerses)
  │     → each queries Supabase directly from the store
  │     → on error: 500ms retry once, only the ones that failed
  │
  ├── set hydrated: true       ← unconditional, even if some fetches failed
  │     (so UI always renders; loading states handle partial data)
  │
  └── if any fetch still failed: error toast
      if all succeeded:
       prefetch verse text (background, non-blocking)
         → fills the Bible session cache
         → so the first verse render in the UI is instant
```

The `hydrated: true` is set unconditionally. This prevents an
infinite loading spinner if any fetch fails. Components should
check `useHydrated()` before reading and gracefully handle empty
arrays.

## Sync model — write-through

**Invariant 1: all Supabase writes live in `lib/`, never in components
or screens.** Components and screens never call the supabase client
directly. They call Zustand actions, or a function from `lib/api/` or
`lib/notifications/`. The writes are in `lib/store/index.ts` (verse and
collection mutations), `lib/storage/`, `lib/api/`, `lib/sync/` and
`lib/notifications/api.ts`. Exception: auth calls in
`lib/auth/context.tsx`. This is what keeps optimistic updates, RLS, and
rollback consistent.

Every write goes to Supabase first (or in parallel) and then
updates Zustand. There is no offline queue.

```
Component dispatches Zustand action
  e.g. useAppStore.getState().addVerse(verse, collectionId, version)
        │
        ▼
Action writes to Supabase
  directly with the supabase client, or through lib/storage/
  (RLS enforces user_id = auth.uid())
        │
        ├── success → Zustand state updated
        │
        └── failure → Zustand NOT updated; error thrown back to caller
                      (some callers surface a toast via lib/toast.ts)
```

Some actions update Zustand optimistically *before* the write and
roll back on failure (`deleteVerse`, `resetVerseProgress`,
`setCollectionSort`). The pattern isn't perfectly uniform — when adding
new actions, decide explicitly whether to apply optimistically or wait
for the server.

## When sync happens

| Trigger | Direction | Notes |
|---|---|---|
| Sign-in or app start with a session | Pull (collections, verses, mastered) | via `hydrate()` |
| Pull-to-refresh | Pull | `refresh()` re-fetches all three |
| Add/delete collection | Push, then local | |
| Add verse | Push, then local | may upsert junction or restore soft-deleted |
| Delete verse | Local, then push, rollback on failure | |
| Verse progress update | Push, then local | `updateVerseProgress`; also computes engraved progression into `progress` JSONB |
| Session attempt | Push only | `logSessionAttempt` in `lib/api/analytics.ts`, called fire-and-forget by `hooks/use-study-session.ts` |
| Study prefs | Local, then push | `setVerseStudyPrefs`, fire-and-forget, no rollback |
| Settings change (colorMode, bibleVersion) | Local only | AsyncStorage write — not synced |

## Offline behavior

**Invariant 10: the app has no offline write support.** Failed writes
are not queued. A session attempt logged while offline is silently lost:
`logSessionAttempt` only logs to the console. Don't assume a write will
eventually succeed — handle errors visibly. If you're tempted to add a
sync queue, write that design down first.

Specifically:

- Failed reads → error state, UI keeps stale in-memory data.
- Failed writes → no queue, no retry. Most store actions throw, and the
  user must retry manually.
- Bible verse reads can succeed offline if they hit the in-memory
  session cache (because the cache is populated during the session), or
  if they're KJV.

NetInfo is wired up (`lib/network/`) and there's a `NoInternetOverlay`
component, but the overlay is a UI-only indicator. Underlying writes
still fail without retry.

## Storage layer — `lib/storage/`

Holds the shared types (`SavedVerse`, `Collection`, `VerseProgress`),
`DEFAULT_PROGRESS`, the row parsers (`parseProgress`,
`parseVerseRowExtras`, `parseSortPreference`), the virtual collection
IDs, and `formatVerseReference`.

The store calls two of its writes: `updateCollectionSort` and
`updateVerseStudyPrefs`. It also has a full set of CRUD functions
(`saveVerse`, `deleteVerse`, `deleteCollection`, `updateVerseProgress`
and others) with the upsert / soft-delete semantics described in
`docs/architecture/data-model.md`. The store doesn't use those; its
actions run their own queries, so a change to the semantics belongs in
the store.

## Sync layer — `lib/sync/`

A one-time migration helper from the local-only era
(`migrateLocalDataToServer`) plus `sync*` wrappers over `lib/storage/`.
Nothing outside `lib/sync/` imports it. The flag
`data_synced_to_server` in AsyncStorage would mark that the migration
ran.

## Verse text caching

Verse text is **not** in Zustand. Where it lives is in
`docs/architecture/bible-api-and-caching.md`.

`hydrate()` triggers a background prefetch of verse text for all of
the user's verses, populating the session cache so that initial
renders don't need to wait on the network.

## Invariants

Invariants 1 and 10 are above. Also:

1. **Components dispatch Zustand actions; actions call Supabase,
   directly or through `lib/storage/`.** Don't shortcut this chain from
   a component.
2. **Don't write to Zustand without writing to Supabase.** Optimistic
   updates only after (or atomically with) the persistent write, with
   a rollback if it comes first. Settings are the exception.
3. **Hydrate sets `hydrated: true` unconditionally.** Don't change
   this — partial data + loading states is better than an infinite
   spinner.
4. **Verse text never goes through Zustand.** The session cache
   handles that. If you find yourself stuffing text into a verse
   row in the store, redirect through `getVerseText`.
5. **`clear()` preserves device prefs by omission.** See `clear()`
   above. Add new device-level prefs the same way.

## Sharp edges

- **Session attempts logged offline are silently lost.** No queue, no
  retry, no error toast. Surface errors visibly when fixing.
- **Hydration race**: components subscribed to Zustand before
  `hydrate()` finishes read empty arrays. Mitigation: check
  `useHydrated()` before rendering data.
- **Optimistic-update inconsistency**: some actions roll back on
  failure (`deleteVerse`), some don't. Audit when adding new ones.
- **Soft-delete filter inconsistency**: most queries filter
  `deleted_at IS NULL`, but the Mastered list intentionally does
  not. Removing the filter from a query you didn't write may
  resurrect deleted verses.
- **Duplicate write paths**: `lib/storage/` and `lib/store/index.ts`
  both implement verse and collection CRUD. Only the store's runs in
  the app.
- **Background prefetch at hydration is uncancelled**. If the user
  signs out mid-prefetch, the in-flight requests still complete
  and the responses are dropped. Wasteful, not dangerous.
