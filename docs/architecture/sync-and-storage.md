# Sync and Storage

> **Status: Living document.** Update when sync semantics, the
> Zustand store shape, or AsyncStorage usage changes. Read before
> touching `lib/store/`, `lib/sync/`, `lib/storage/`, or anything
> that hydrates state at app start.

The app's storage strategy is **server-of-record, in-memory state,
no offline writes**. Supabase is the source of truth for all user
data. Zustand holds the current view of that data in memory.
AsyncStorage holds device settings only.

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
| Auth session | — | (via Supabase) | ✓ (Supabase-managed) |
| Migration flag | — | — | ✓ (`data_synced_to_server`) |

**Nothing user-data-related is persisted to AsyncStorage.** The app
does not work offline for writes — see the offline section below.

## Zustand store

`lib/store/index.ts`. The store is built with `zustand` (no
`persist` middleware on data — only the two settings are written to
AsyncStorage manually).

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

  // Lifecycle flags
  hydrated: boolean;
  collectionsLoading: boolean;
  versesLoading: boolean;
  masteredLoading: boolean;
  error: string | null;

  // Actions
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  fetchCollections: () => Promise<void>;
  fetchVerses: () => Promise<void>;
  fetchMasteredVerses: () => Promise<void>;
  setColorMode: (mode) => Promise<void>;
  setBibleVersion: (v) => Promise<void>;
  addCollection: (name) => Promise<Collection>;
  deleteCollection: (id) => Promise<void>;
  addVerse: (verse, collectionId, version) => Promise<void>;
  deleteVerse: (id, collectionId) => Promise<void>;
  updateVerseProgress: (id, difficulty, accuracy) => Promise<void>;
  resetVerseProgress: (id) => Promise<void>;
  clear: () => void;
}
```

### Selectors

The convention is `useX(...)` selectors, not direct
`useAppStore(...)` calls in components:

| Selector | Returns |
|---|---|
| `useCollections()` | `Collection[]` |
| `useVerses()` | `SavedVerse[]` |
| `useHydrated()` | `boolean` |
| `useVerse(id)` | one verse from `verses` or `masteredVerses` |
| `useVersesByCollection(id)` | filtered verse list |
| `useMasteredVerses()` | `masteredVerses` |
| `useMostMemorizedBooks()` | top 5 books by mastered count |
| `useInsightsStats()` | `{ versesMastered, inProgress }` |

### Persistence

- `colorMode` and `bibleVersion` are written to AsyncStorage in
  `setColorMode` / `setBibleVersion` (manually, not via `persist`
  middleware).
- All other state is in-memory only. On app restart it's empty
  until `hydrate()` runs.

### `clear()`

Wipes user data on sign-out. Device-level prefs (`colorMode`,
`bibleVersion`, `reviewMaxIntervalDays`) are **preserved by
omission** — `clear()` calls `set(...)` listing only the data and
loading-state keys, and Zustand keeps everything else. If you add
another device-level pref, just don't list it in `clear()`'s `set`.

## Hydration

Called at app start by `AuthProvider` after the session is
restored.

```
hydrate()
  ├── Promise.all(AsyncStorage.getItem on COLOR_MODE_KEY,
  │                BIBLE_VERSION_KEY, REVIEW_MAX_INTERVAL_DAYS_KEY)
  │     → set colorMode, bibleVersion in store
  │
  ├── Promise.all(fetchCollections, fetchVerses, fetchMasteredVerses)
  │     → each queries Supabase via lib/storage/
  │     → on error: 500ms retry once
  │
  ├── set hydrated: true       ← unconditional, even if some fetches failed
  │     (so UI always renders; loading states handle partial data)
  │
  └── if all succeeded:
       prefetch verse text (background, non-blocking)
         → fills the Bible session cache
         → so the first verse render in the UI is instant
```

The `hydrated: true` is set unconditionally. This prevents an
infinite loading spinner if any fetch fails. Components should
check `useHydrated()` before reading and gracefully handle empty
arrays.

## Sync model — write-through

Every write goes to Supabase first (or in parallel) and then
optimistically updates Zustand. There is no offline queue.

```
Component dispatches Zustand action
  e.g. useAppStore.getState().addVerse(verse, collectionId, version)
        │
        ▼
Action calls storage layer
  e.g. lib/storage/saveVerse(...)
        │
        ▼
Storage writes to Supabase
  (RLS enforces user_id = auth.uid())
        │
        ├── success → Zustand state updated optimistically
        │
        └── failure → Zustand NOT updated; error thrown back to caller
                      (most actions surface a toast via lib/toast.ts)
```

Some actions update Zustand optimistically *before* the write and
roll back on failure (`deleteVerse` is one such case). The pattern
isn't perfectly uniform — when adding new actions, decide
explicitly whether to apply optimistically or wait for the server.

## When sync happens

| Trigger | Direction | Notes |
|---|---|---|
| App start (after auth restored) | Pull (collections, verses, mastered) | via `hydrate()` |
| Sign-in | Pull | new session triggers hydration |
| Pull-to-refresh | Pull | `refresh()` re-fetches all three |
| Add/delete collection | Push + optimistic | |
| Add/delete verse | Push + optimistic | may upsert junction or restore soft-deleted |
| Verse progress update | Push + optimistic | also writes to `session_attempts` |
| Engraved progression | Push + optimistic | computed in store, persisted to `progress` JSONB |
| Settings change (colorMode, bibleVersion) | Local only | AsyncStorage write — not synced |

## Offline behavior

**Writes are not supported offline.** Specifically:

- Failed reads → error state, UI keeps stale in-memory data.
- Failed writes → exception thrown, no queue, no retry. User must
  retry manually.
- **Session attempts logged offline are silently lost.** This is a
  known data-loss bug — see invariant #10 in CLAUDE.md.
- Bible verse reads can succeed offline if they hit the in-memory
  session cache (because the cache is populated during the session).

NetInfo is wired up (`@react-native-community/netinfo`) and there's
a `NoInternetOverlay` component, but the overlay is a UI-only
indicator. Underlying writes still fail without retry.

## Storage layer — `lib/storage/`

The storage layer wraps Supabase calls with the upsert / soft-delete
semantics described in `docs/architecture/data-model.md`. Key
functions:

| Function | Purpose |
|---|---|
| `getCollections(userId)` | active collections + virtual `@mastered` |
| `saveCollection(userId, name)` | insert with `client_id` |
| `deleteCollection(userId, id)` | soft-delete + cascade (handle each verse: soft, junction-remove, or hard) |
| `getSavedVerses(userId)` | active verses with their collection memberships |
| `saveVerse(...)` | insert verse + junction; handles restoration of soft-deleted verse |
| `deleteVerse(userId, verseId, collectionId)` | remove junction; soft/hard-delete verse based on mastery + remaining memberships |
| `updateProgress(verseId, progress)` | write the JSONB `progress` field |

Components should not call these directly — they go through Zustand
actions.

## Sync layer — `lib/sync/`

Currently slim. Mostly a one-time migration helper from the local-only
era (`lib/sync/migration.ts`). The flag
`data_synced_to_server` in AsyncStorage marks that the migration ran;
checked by `isMigrationComplete()` before running again. Today the app
writes directly to Supabase, so the migration is a no-op — but the
guard remains so we don't double-sync if local-first ever returns.

## Verse text caching

Verse text is **not** in Zustand. Verse text lives in:

- `verse_cache` table on Supabase (server, capped at 500 per version,
  LRU evicted)
- The in-memory session cache in `lib/cache/session-cache.ts` (clears
  on app restart)

See `docs/architecture/bible-api-and-caching.md` for the full
pipeline.

`hydrate()` triggers a background prefetch of verse text for all of
the user's verses, populating the session cache so that initial
renders don't need to wait on the network.

## Invariants

1. **All Supabase writes go through `lib/storage/` (or `lib/sync/`,
   or `lib/api/`).** Never call `supabase.from(...)` directly from
   components or screens. Auth in `lib/auth/context.tsx` is the
   single exception.
2. **Components dispatch Zustand actions; actions call storage;
   storage calls Supabase.** Don't shortcut this chain.
3. **Don't write to Zustand without writing to Supabase.** Optimistic
   updates only after (or atomically with) the persistent write.
4. **Hydrate sets `hydrated: true` unconditionally.** Don't change
   this — partial data + loading states is better than an infinite
   spinner.
5. **Verse text never goes through Zustand.** The session cache
   handles that. If you find yourself stuffing text into a verse
   row in the store, redirect through `getVerseText`.
6. **`clear()` preserves device prefs by omission.** `colorMode`,
   `bibleVersion`, and `reviewMaxIntervalDays` survive sign-out
   because `clear()` doesn't list them in its `set(...)` call. Add
   new device-level prefs the same way — just don't include them.
7. **No offline write queue exists.** Don't pretend writes will
   eventually succeed. If a feature needs offline durability, that's
   a feature doc.

## Sharp edges

- **Session attempts logged offline are silently lost.** Surface
  errors visibly when fixing.
- **Hydration race**: components subscribed to Zustand before
  `hydrate()` finishes read empty arrays. Mitigation: check
  `useHydrated()` before rendering data.
- **Optimistic-update inconsistency**: some actions roll back on
  failure (`deleteVerse`), some don't. Audit when adding new ones.
- **Soft-delete filter inconsistency**: most queries filter
  `deleted_at IS NULL`, but the Mastered list intentionally does
  not. Removing the filter from a query you didn't write may
  resurrect deleted verses.
- **Migration flag persists after reset**: `resetMigration()`
  exists but is only used in tests. If you ever run a real
  re-sync, double-check the flag.
- **Background prefetch at hydration is uncancelled**. If the user
  signs out mid-prefetch, the in-flight requests still complete
  and the responses are dropped. Wasteful, not dangerous.
