# Sync and Storage

The app's storage strategy is **server-of-record, in-memory state,
no offline writes**. Supabase is the source of truth for all user
data. Zustand holds the current view of that data in memory.
AsyncStorage holds device settings, small local caches and the saved
library (below).

## What lives where

| Data | Server (Supabase) | Zustand (in-memory) | AsyncStorage |
|---|:-:|:-:|:-:|
| Collections | ✓ | ✓ | ✓ saved library |
| Verses (references, progress; never text) | ✓ | ✓ | ✓ saved library |
| Mastered verses (incl. soft-deleted) | ✓ | ✓ | ✓ saved library |
| [Curated saver totals](../features/home.md#community-saves) | ✓ (ledger) | ✓ | — |
| [Intro presentation claims](../features/home.md#encouragement-video) | ✓ | runtime coordinator | — |
| Session attempts | ✓ (append) | — | — |
| Verse text | ✓ (`verse_cache`) | session cache (`lib/cache/`) | — |
| `colorMode` | — | ✓ | ✓ (`app_color_mode`) |
| Account translation (`bibleVersion`) | ✓ (`profiles.translation`) | ✓ | ✓ cache (`app_bible_version`) |
| Name (`displayName`, `firstName`, `lastName`) | ✓ (`profiles`) | ✓ | ✓ saved library |
| [Shared groups](../features/shared-collections.md#in-the-app) | ✓ | ✓ | ✓ saved library (owner names too); last seen ids and names (`shared_known_groups:<user>`) |
| [Group progress](../features/group-progress.md#collection-screen) | ✓ (read) | ✓ (`sharedProgress`) | — |
| Invite from a signed-out link or a claimed handoff | — | — | ✓ (`shared_pending_join`) |
| Install handoff asked once | — | — | ✓ (`shared_handoff_checked`) |
| Translation notices | — | — | ✓ (`translation_account_note_seen`, `translation_kept_notices`) |
| `reviewMaxIntervalDays` | — | ✓ | ✓ (`review_max_interval_days`) |
| Virtual collection sorts | — | ✓ | ✓ (`library_sort_mastered`, `library_sort_in_progress`) |
| Other collections' sort | ✓ (`sort_preference`) | ✓ | — |
| Notification prefs | ✓ | ✓ (`usePrefsStore`) | ✓ cache (`notifications_prefs_cache:<userId>`) |
| Notification flags, push token | — | ✓ (`useUxFlagsStore`, flags) | ✓ (`notifications_q1_dismissed`, `notifications_settings_visited`, `notifications_cached_expo_token`) |
| Auth session | — | (via Supabase) | ✓ (Supabase-managed) |

**Library data reaches disk only as the saved library**
(`library_snapshot:<userId>`, below), never verse text. The app does
not work offline for writes — see the offline section below.

## Saved library

`lib/store/snapshot.ts` (tested in `snapshot.test.ts`): `{ v: 1,
savedAt, collections, verses, masteredVerses, sharedCollections, names }`,
each field copied by an explicit allowlist:

- verses: `id, collectionId, book, chapter, verseStart, verseEnd,
  version, createdAt, progress, lastPracticedAt, lastChunkSize,
  lastDifficulty, updatedAt`. Never `text` or `verses` (invariant 2);
  reading drops them too.
- collections (not the virtual ones), shared groups with owner names,
  and the user's own name, so nothing pops in after the paint.
- `parseSnapshot` refuses another `v`, an age over
  `SNAPSHOT_MAX_AGE_MS` (7 days) or a malformed value; that key is
  removed.

**Read** when an account starts (`paintSnapshot`), a frame after the
wave's requests go out: one update with the data, `hydrated: true`,
`hydratedFrom: 'snapshot'`, minus any list the wave already applied.
The wave then replaces it (`painted` lets a read started before the
paint replace the painted lists). A launch whose session is still
restoring paints the stored user's copy first (see [auth.md](auth.md#launch));
otherwise `AuthProvider` awaits the paint before its first render.

**Written** (`saveSnapshot` in `lib/store/index.ts`) only from
server-applied state: when `synced` turns true, after each later wave,
and after these succeed: progress saves, add, copy and delete verse,
add, import, rename, icon, reorder and delete collection, join, leave,
stop sharing, set name. Never from a store subscriber (it would save
unconfirmed study prefs), never before `synced`, and the generation
is checked with no `await` before `setItem`.

**Removed** on sign-out and account delete (`setAccount(null)`).

### `synced`

`hydrated` means something to paint; `synced` means the server's
collections, verses, mastered rows and shared groups were all
**applied** this account (a read that lands after a change made during
it keeps the change and doesn't count; the wave reads it once more).
`whenSynced()` waits for the running wave, then refreshes once.
Anything that decides from data a saved copy could have wrong waits on
it through `librarySynced()`, which toasts "Couldn't load your library"
on false: delete and leave confirms, stop sharing, member actions,
verse delete, the Join tap, the share screen's first step, Add/Open on
a curated collection, adding a verse, and "not found" states.
Progress saves need no wait: the guard refuses a stale base
([review.md](../features/review.md#concurrent-updates-from-two-devices)).

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
  sharedCollections: Record<string, SharedCollectionInfo>; // by group id, see shared-collections.md
  sharedProgress: Record<string, SharedProgress>; // members × references, read when a shared collection opens

  // Settings (also in AsyncStorage)
  colorMode: 'system' | 'light' | 'dark';
  bibleVersion: BibleVersion;
  displayName: string | null;   // profiles.display_name ("Caelan L."); not in AsyncStorage, cleared by clear()
  firstName, lastName           // profiles.first_name, last_name; same
  reviewMaxIntervalDays: number;
  masteredSort: SortOption;
  inProgressSort: SortOption;

  // Lifecycle flags
  hydrated: boolean;            // something to paint: the saved library or the server's
  hydratedFrom: 'snapshot' | 'server' | null;
  synced: boolean;              // see Saved library
  profileLoaded: boolean;       // the profile was read this run; welcomeSeen is the server's
  welcomeSeen: boolean;         // profiles.welcome_v2_seen_at is set
  lastSessionAt: number | null; // last progress save this run (Home's reload rule)
  collectionsLoading: boolean;
  collectionOrderSaving: boolean;
  versesLoading: boolean;
  masteredLoading: boolean;
  error: string | null;

  // Actions
  hydrate: (userId) => Promise<void>; // from setAccount only
  refresh: () => Promise<void>;
  whenSynced: () => Promise<boolean>;
  paintSnapshot: (userId) => Promise<void>; // the saved library only
  showOffline: (userId) => Promise<void>;   // offline launch, nothing saved
  clearError: () => void;
  fetchCollections: () => Promise<boolean>;
  fetchVerses: () => Promise<boolean>;
  fetchMasteredVerses: () => Promise<boolean>;
  setColorMode: (mode) => Promise<void>;
  setBibleVersion: (v) => Promise<void>;
  setReviewMaxIntervalDays: (days) => Promise<void>;
  addCollection: (name, iconKey?) => Promise<Collection>;
  importCuratedCollection: (catalogId) => Promise<{ collectionId: string; loaded: boolean }>;
  setCollectionIcon: (id, iconKey) => Promise<void>;
  renameCollection: (id, name) => Promise<void>;
  reorderCollections: (ids) => Promise<void>;
  deleteCollection: (id) => Promise<void>;
  setCollectionSort: (collectionId, sort) => Promise<void>;
  // Shared collections: docs/features/shared-collections.md#in-the-app
  fetchSharedCollections: () => Promise<boolean>;
  shareCollection: (collectionId) => Promise<{ sharedId: string; code: string }>;
  mintInvite: (sharedId) => Promise<{ code: string; expiresAt: string }>;
  joinSharedCollection: (code) => Promise<string>;   // the copy's client_id
  fetchSharedProgress: (sharedId) => Promise<boolean>;  // never throws; a failure sets `failed` on the entry
  openSharedCollection: (sharedId, { pull? }) => Promise<boolean>; // sync, then one wave; false once no longer shared
  leaveSharedCollection: (sharedId) => Promise<void>;
  removeSharedMember: (sharedId, userId) => Promise<void>;
  setSharedMemberRole: (sharedId, userId, role) => Promise<void>;
  addVerse: (verse, collectionId) => Promise<SavedVerse>;
  copyVerseToCollection: (verseId, collectionId) => Promise<void>;
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
| `useHydrated()` | `boolean` |
| `useVerse(id)` | one verse from `verses` or `masteredVerses` (`findVerse` outside React) |
| `useVersesByCollection(id)` | filtered verse list |
| `useMasteredVerses()`, `useMasteredVerseCount()` | `masteredVerses`, its count |
| `useInProgressVerses()`, `useInProgressVerseCount()` | the virtual In Progress list, its count |
| `useDueCounts()` | review state, see `docs/features/review.md` |
| `useMostMemorizedBooks()` | top 5 books by mastered count |
| `useSharedCollection(id)` | the group a collection is a copy of: role, member and verse counts, mastered and engraved squares |
| `useSharedOwnerName(id)` | that group's owner's display name (yours when you own it), or null |
| `useAddableCollections()`, `versesLostWith(id)` | collections the user may add to; verses a delete or leave would lose now (not a hook) |
| `useInsightsStats()` | `{ versesMastered, inProgress }` |

### Persistence

- Settings and virtual-collection sorts are written to AsyncStorage
  in their setters (manually, not via `persist` middleware), and read
  once at module load (`settingsRead`, before the first frame). The
  translation is the exception: it's saved to `profiles`, and AsyncStorage
  only caches it. See `docs/architecture/bible-versions.md`.
- The library is in memory, plus the saved library above. On app
  restart it's the saved copy (or empty) until the wave lands.

### `clear()`

Wipes user data on sign-out and before another account starts. Device-level prefs (`colorMode`,
`reviewMaxIntervalDays`, `masteredSort`, `inProgressSort`) and the
cached translation (`bibleVersion`, replaced from the next account's
profile on hydrate) are **preserved by omission** — `clear()` calls
`set(...)` listing only the data and loading-state keys, and Zustand
keeps everything else. If you add another device-level pref, just
don't list it in `clear()`'s `set`.

`clear()` also advances the account generation. Collection rename, reorder
and copy use the session that started them and ignore late completions.
Library fetches and hydration stop publishing results from that generation.

## Hydration

Called by `setAccount` (`lib/auth/account.ts`) as soon as `AuthProvider` reads the
session, before the tree mounts, and when another account signs in. See
[auth.md](auth.md#accounts-start-from-the-session).

```
setAccount(userId) — when AuthProvider reads the session, before the tree mounts
hydrate(userId)
  ├── await settingsRead (module load: colorMode, bibleVersion,
  │     reviewMaxIntervalDays, masteredSort, inProgressSort, hideVerseText)
  ├── meanwhile paintSnapshot, a frame later: library_snapshot:<userId> → one set
  │
  └── loadAccount, started first (queued with other translation work; refresh() runs it too)
        ├── one wave, Promise.all: profiles (translation, names, welcome_v2_seen_at),
        │     the verse identity rows, fetchCollections, fetchVerses,
        │     fetchMasteredVerses, fetchSharedCollections
        │     → a failed profile or identity read doesn't stop the fetches
        │     → launch only: failed fetches retried once after 500ms
        ├── no profile: seedTranslation from the rows, profiles.upsert
        ├── a read dropped for a change made during it reads once more
        ├── one set: bibleVersion (unless a switch is in flight), names,
        │     profileLoaded, welcomeSeen, hydrated: true ← unconditional,
        │     hydratedFrom: 'server', synced → then the snapshot is saved
        │     → launch only: toast if a fetch still failed
        ├── alignVerses with the wave's rows; if it moved anything or the
        │     translation changed, fetchVerses + fetchMasteredVerses again
        └── launch only, all fetches ok: after interactions, preload verse text
```

`hydrated: true` is unconditional (invariant 3 below).

## Sync model — write-through

**Invariant 1: all Supabase writes live in `lib/`, never in components
or screens.** Components and screens never call the supabase client
directly. They call Zustand actions, or a function from `lib/api/` or
`lib/notifications/`. The writes are in `lib/store/index.ts` (verse and
collection mutations), `lib/storage/`, `lib/api/` and
`lib/notifications/api.ts`. Exception: auth calls in
`lib/auth/context.tsx`. This is what keeps optimistic updates, RLS, and
rollback consistent.

Every write goes to Supabase first (or in parallel), then to Zustand.

```
Component → Zustand action (e.g. addVerse) → Supabase write, directly
  or through lib/storage/ (RLS enforces user_id = auth.uid())
    ├── success → Zustand state updated
    └── failure → Zustand NOT updated; error thrown back to the caller
                  (some callers toast via lib/toast.ts)
```

Some actions update Zustand optimistically *before* the write and
roll back on failure (`deleteVerse`, `resetVerseProgress`,
`setCollectionSort`); others don't. For a new action, decide whether
to apply optimistically or wait for the server.

## When sync happens

| Trigger | Direction | Notes |
|---|---|---|
| Sign-in or app start with a session | Pull (profile, collections, verses, mastered, shared) | `setAccount` → `hydrate()`, one wave |
| Pull-to-refresh | Pull | `refresh()`: the same wave as hydrate, plus curated save counts; a shared collection's is [one wave](../features/group-progress.md#collection-screen) |
| Resume: back after `RESUME_AWAY_MS` (30 s) away | Pull | `resumeTracker` (`lib/resume.ts`; Control Center or a quick switch isn't one): `syncForegroundState` heartbeat, curated save counts. Home: [its rule](../features/home.md#monthly-schedule-and-loading) |
| Add/delete collection | Push, then local | |
| Add verse | Push, then local | one `add_verse` call ([adding-verses.md](../features/adding-verses.md#verse-identity)); shared copies use `addSharedVerse` |
| Delete verse | Local, then push, rollback on failure | |
| Verse progress update | Push, then local | `updateVerseProgress`; also computes engraved progression into `progress` JSONB |
| Session attempt | Push only | `logSessionAttempt` in `lib/api/analytics.ts`, called fire-and-forget by `hooks/use-study-session.ts` |
| Study prefs | Local, then push | `setVerseStudyPrefs`, fire-and-forget, no rollback |
| Translation change | Local, then push, rollback on failure | `setBibleVersion`: profile, then every verse row, then refetch. See `docs/architecture/bible-versions.md` |
| Settings change (colorMode) | Local only | AsyncStorage write — not synced |

## Offline behavior

**Invariant 10: the app has no offline write support.** Failed writes
are not queued. A session attempt logged while offline is silently lost:
`logSessionAttempt` only logs to the console. Don't assume a write will
eventually succeed — handle errors visibly. If you're tempted to add a
sync queue, write that design down first.

Specifically:

- Failed reads → error state, UI keeps stale in-memory data. A cold
  start offline shows the saved library; `synced` stays false, so
  deletes and name steps toast instead of acting. With nothing saved,
  after `SPLASH_FAILSAFE_MS` (3 s) `showOffline` shows it empty with
  the load-error toast, still signed in; `TOKEN_REFRESHED` starts the
  wave once the network is back ([launch](navigation-and-routing.md#launch-splash)).
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
`parseVerseRowExtras`, `parseSortPreference`, `parseCollectionRow`), `DEFAULT_COLLECTION_ID`
and the virtual collection IDs, and `formatVerseReference`.

Its two writes, `updateCollectionSort` and `updateVerseStudyPrefs`, are
called by the store. Every other verse and collection write is a store
action, and every verse read goes through the store.

## Verse text caching

Verse text is **not** in Zustand. Where it lives is in
`docs/architecture/bible-api-and-caching.md`.

After the first paint, the store preloads verse text into the session
cache, a few at a time, and a collection opening goes first; nothing
with Hide verses on. The rules are in
[bible-api-and-caching.md](bible-api-and-caching.md#preloading-verse-text).

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
- **Soft-delete filter inconsistency**: most queries filter
  `deleted_at IS NULL`, but the Mastered list intentionally does
  not. Removing the filter from a query you didn't write may
  resurrect deleted verses.
- **Duplicate write paths**: `lib/storage/` and `lib/store/index.ts`
  both implement verse and collection CRUD. Only the store's runs in
  the app.
- **The preload stops between requests, not during one.** On sign-out
  up to 3 in-flight reads still complete into the session cache.

## Decisions

- **The library is saved to disk (Q16, Q18).** Reverses "never
  persisted": Caelan wanted the Library to show at once, Spotify-style.
  The allowlist keeps verse text off the device.
- **Sign-out removes the saved library (Q21).** Shared devices; a
  sign-in again loads from the server.
- **The wave's requests go out before the saved library paints.** Painting
  first held them behind the list's render (server data at 731 ms vs 457 ms).
- **Reloads on return wait for 30 s away (Q26).** Control Center or a
  quick app switch fired a burst of reads.

## Browser checks

- `npm run sim -- flow startup-timing`: reader-c with 150ms added to every Supabase request, 5
  cold launches to Home and 5 to the Library; the `[PERF]` lines in `.expo/sim-metro.log` give
  each launch's marks and requests (`lib/api/dev-timing.ts`, dev builds on a local DB only).
  Start from `npm run db:reset`.
- `npm run sim -- flow snapshot-cold-start`: a relaunch with 10s added
  to every request shows reader-c's Library from the saved copy.
