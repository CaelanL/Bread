# Library

The Library tab is where users organize saved verses. One verse can belong to many
collections. Two more collections, Mastered and In Progress, are computed in the
client and have no database row.

## Data

```
user_collections ←─ verse_collections ─→ user_verses
                     (verse_id, collection_id, added_at)
```

Full schema is in `docs/architecture/data-model.md`. Three things matter here:

- **IDs in the app are `client_id`s, not UUIDs.** `Collection.id`, `SavedVerse.id` and
  the `[id]` route param are all `client_id`. The store looks up the server UUID for
  each write.
- **`state.verses` has one entry per collection membership.** `fetchVerses` queries
  through the junction, so a verse in two collections appears twice with the same
  `id` and different `collectionId`. Its `createdAt` is the junction's `added_at`.
  Dedupe by `id` when you count verses.
- **`state.masteredVerses` is a separate list.** `fetchMasteredVerses` reads
  `user_verses` directly with no `deleted_at` filter, so it includes soft-deleted
  rows. Here `createdAt` is the row's `created_at`.

## Routes

| Route (`app/(tabs)/(library)/`) | Purpose |
|---|---|
| `index.tsx` | Collection list, pull to refresh, Edit, and the + menu |
| `[id].tsx` | One collection: `CollectionHeader` (icon, name, Search, sort and Add pills), flat verse rows, long press to copy, a menu |
| `add.tsx` | Quick-add field, then pick a book and chapter. Its picker sets the account translation. Passes `collectionId` along |
| `add/[book]/[chapter].tsx` | Read the chapter and select a verse range |
| `setup/[id].tsx` | Study setup and Reset Progress. See `docs/features/study-session.md` |

Collections and verses open by `client_id`, so `/(tabs)/(library)/mastered` works the
same as a real collection. Notification taps use that path
(`docs/features/notifications.md`).

## Collections

`fetchCollections` pins My Verses, Mastered and In Progress. Custom collections
follow saved positions, then creation time and client ID. New collections append.

Long-press a custom collection for Rename, Reorder and Delete, plus Share… on one you own. Shared collections change the menu, swipe, add and delete; see
[shared collections](shared-collections.md#in-the-app). On iOS, one light
haptic confirms it. The menu opens under the press, and `PopoverMenu` moves it up to stay
inside the safe area. Rename prefills
`AddCollectionModal`. Reorder or Edit reveals drag handles with accessibility
actions to move up or down. Each drop saves the order, rolling back on failure.
Done ends editing.

Collections are flat rows split by `separator` hairlines, like verse rows inside a
collection, with no cards. Each row: the icon square, name, a subtitle (verse count; "<owner's first name> · M members" once someone else
is in a shared one), then the due pill on Mastered, a check or engraved glyph once every verse is
mastered or engraved (engraved also fills the square and washes the row gold; see
[group progress](group-progress.md#library-cards)). No chevron: the whole row opens it.

**Hide verses.** Settings → Appearance → Hide verses (`hideVerseText`, a device pref in the store,
kept across sign-out like Theme, default off) drops the text line from a collection's verse rows
(`SwipeableVerseCard`, which then skips the text fetch) and from Study setup's preview card, where
the expand button still shows the full text.

**My Verses** is the default. Its `client_id` is `my-verses`, with `is_default` true.

- It's created lazily by `add_verse` or `copy_verse_to_collection`, with `created_at`
  at the epoch so it sorts first. Until then `fetchCollections` adds a local
  `DEFAULT_COLLECTION`.
- Its name and position are fixed in the app. `SwipeableCollectionCard` disables
  its delete action, and the store's `deleteCollection` returns early.
- An add to a collection that no longer exists is an error, not a move here.

**Mastered** has the ID `mastered` (`MASTERED_COLLECTION_ID`).

- It holds verses where `progress.hard.completed` is true, including soft-deleted ones.
- Mastery is the only way in. `isVirtual` removes the + button, and
  `AddToCollectionModal` filters virtual collections out.
- Swipe is disabled on its rows; only [Reset Progress](#reset-progress) takes a verse out.
- The list row shows `DueCountPill` from `useDueCounts`. Due and engraved rules are in
  `docs/features/review.md`.

**In Progress** has the ID `in-progress` (`IN_PROGRESS_COLLECTION_ID`).

- It holds verses matching `isInProgressVerse`: any non-null `bestAccuracy` on any
  difficulty, and not mastered on Hard. `useInProgressVerses` dedupes by `id`.
- The Insights count uses the same predicate, so the two match
  (`docs/features/insights.md`).
- The push nudge mirrors it on the server, and the two must change together
  (`docs/features/notifications.md`).
- `index.tsx` hides the row at zero, though `fetchCollections` always includes it: the
  store's list isn't always what's on screen.
- It has no + button and no swipe. Verses live in real collections, and this is a view.
- It isn't part of review scheduling.

## Sharing from the Library

+ opens a `PopoverMenu` under the button (`library-add`) with three rows:

| Row | Opens |
|---|---|
| New collection | `AddCollectionModal` |
| New shared collection | `app/share/new`: your display name if you have none, then the collection's name, then it creates and shares it in one go and shows the code |
| Join with code | `app/join/index.tsx`, the typed code |

Share… on a personal collection's long-press menu opens `app/share/<id>`, which shares it and
shows the same panel. Both check the 20-group cap first. The share, join and name steps are
`ModalCard`s in native modal routes, never RN `Modal`s held in the Library's state; see
[navigation](../architecture/navigation-and-routing.md#modal-routes) for why. What the panel shows
is in [shared collections](shared-collections.md#in-the-app).

## Sorting verses

The sort pill cycles through `cycleSort` (`lib/store/library-sort.ts`). Only Mastered has Due first.

| Sort | Order (`sortVerses`) |
|---|---|
| Recent | `lastPracticedAt` newest first. Never-practiced verses come after, by `createdAt` newest first |
| A-Z | `formatVerseReference` with `localeCompare` |
| Mastery | Engraved, then Hard, Medium, Easy, none |
| Due first | `daysUntilDue` ascending, then `createdAt` newest first |

`useCollectionSort` picks the sort by collection ID. It's saved per collection:

| Collection | Saved in | Default |
|---|---|---|
| Real collections | `user_collections.sort_preference`, so it follows the account | `recent` |
| Mastered | AsyncStorage `library_sort_mastered`, this device only | `due-first` |
| In Progress | AsyncStorage `library_sort_in_progress`, this device only | `recent` |

`setCollectionSort` updates the store first. For a real collection, a failed write
rolls back and shows a toast. The sort pill shows only on a collection with verses, so its
row exists. The two AsyncStorage values survive sign-out, because `clear` doesn't touch them.
`parseSortPreference` treats an unknown value as no preference.

**`last_practiced_at`** (migration `016_sort_and_last_practiced.sql`) is per verse. The
store's `updateVerseProgress` writes it on every completed session, full or partial,
whether or not the score improved. Practicing a verse floats it under Recent in every
collection it's in. `resetVerseProgress` clears it. The column was never backfilled.

Sort and search run in JS in memory. Search (`SearchTakeover`) grows from its pill and takes
the screen; `filterVerses` (`lib/search.ts`) matches a book prefix, then chapter and verse.

## Adding a verse

The add screen, quick add, the chapter range gesture and `addVerse`'s identity rules are in
`docs/features/adding-verses.md`.

## Copying a saved verse

Long-press a verse for Copy to collection. On iOS, one light haptic confirms
the picker opens. Choose My Verses or a custom collection ([shared ones](shared-collections.md#in-the-app)).
Already added destinations are disabled. A failed copy keeps the picker open.

`copyVerseToCollection` adds one membership for the existing verse, so it stays
in the source collection and shares its version, progress and study preferences.
A soft-deleted verse copied from Mastered is restored as part of the same write.
See `docs/architecture/data-model.md` for the database operations.

## Versions and KJV offline

Saved verses follow the account translation, and the add screens' picker changes it
(`docs/architecture/bible-versions.md`).

KJV ships in the app (public domain), so reading a saved KJV verse needs no network or API
quota; other versions need a connection unless cached. Only reading is offline: saves and
progress still need the network
(invariant 10, `docs/architecture/sync-and-storage.md`). The bundle itself is in
`docs/architecture/bible-api-and-caching.md`.

## Curated collections

Tap a custom collection's header icon, or Change icon in its menu, to change it. See [Explore collections](home.md#explore-collections) for imports and [save totals](home.md#community-saves).

## Deleting a verse

`deleteVerse(id, collectionId)` in the store removes the card first, then makes one call to
`public.delete_verse` (`supabase/migrations/20261112230000_delete_verse.sql`), which:

1. Removes the junction row for this collection.
2. If other collections still hold the verse, stops.
3. If none do and the verse is mastered, soft-deletes it. It stays in Mastered.
4. If none do and it isn't mastered, hard-deletes it. Junction rows cascade.
   `session_attempts` rows survive, since they have no foreign key to the verse.

It succeeds whole or changes nothing, and a retry after success is a no-op. It refuses a shared
copy, whose verses leave through the group. A failure puts the card back and rethrows.

`delete_collection` and `private.remove_verse_from_collection` ([shared leave and
remove](shared-collections.md#leave-and-remove)) repeat the rule. Change all three together.

`SwipeableVerseCard` picks its confirmation text from the same facts, using
`collectionCount` from `[id].tsx`:

| Situation | Title | Result |
|---|---|---|
| In other collections | Remove from collection? | Only this junction row goes |
| Only here, mastered | Remove from collection? | Soft delete, stays in Mastered |
| Only here, not mastered | Delete verse? | Hard delete, progress is lost |

## Deleting a collection

Swipe a custom collection, or a verse in a real collection, left for Delete, which opens the
confirmation; the collection long-press menu offers it too.

`deleteCollection` returns early for My Verses; a member's shared copy is left. Otherwise
one `public.delete_collection` call (latest in `*_delete_collection_for_everyone.sql`) does it
in one transaction: an owner's group [dissolves](shared-collections.md#dissolve), every verse
leaves, a verse no other collection holds is soft-deleted if mastered and hard-deleted
otherwise, and the collection gets `deleted_at`. All or nothing; a retry after success is a
no-op. It refuses My Verses and a member's copy. Only after it succeeds does the store drop
the collection (and its group) locally. Virtual collections never get here (their
swipe is disabled); the function would answer `Collection not found`.

## Reset progress

`resetVerseProgress(id)` in the store sets `progress` to `DEFAULT_PROGRESS` and clears
`last_practiced_at`. It's reached from Reset Progress on `setup/[id].tsx`. It's the only
way a verse leaves Mastered.

## Invariants

1. Verse identity is user, book, chapter and range. Version follows the account translation.
2. My Verses can't be deleted. Don't add a bypass.
3. Mastered and In Progress have no row. Code that expects every collection ID to map to
   `user_collections` breaks on them, so check `isVirtual` or the ID constants.
4. Mastery lasts until reset. Removing a mastered verse from every collection keeps it in
   Mastered.
5. Delete logic branches on `progress.hard.completed`. `DEFAULT_PROGRESS` and
   `parseProgress` in `lib/storage/index.ts` define the shape, and a malformed `progress`
   would hard-delete a mastered verse.
6. Screens don't write `verse_collections` or the other Library tables directly. Go through
   the store actions (invariant 1, `docs/architecture/sync-and-storage.md`).

## Sharp edges

- **Reset on a soft-deleted mastered verse doesn't update the Mastered list.**
  `resetVerseProgress` works out `wasMastered` from `verses` alone, and such a verse is only
  in `masteredVerses`. It stays listed with old progress until the next fetch. After that the
  row stays soft-deleted, in no list, until the user re-adds it.
- **Re-adding a soft-deleted verse restores it,** keeping mastery on purpose, so a "new"
  verse can arrive with progress.
- **A-Z isn't numeric.** `localeCompare` on the reference puts John 10 before John 3.
- **The empty hint never shows.** `index.tsx` renders it at `collections.length <= 1`, but My
  Verses and Mastered are always present once hydrated.

## Browser checks

- `npm run sim -- flow hide-verses`: turn Hide verses on, check My Verses and Study setup show no verse text, turn it off.
- `npm run sim -- shot '/(tabs)/(library)' --as reader-a`: My Verses, Mastered with a "1 due" pill, In Progress, and Psalms.
- `npm run sim -- shot '/(tabs)/(library)' --as reader-b`: My Verses and Mastered only, with no In Progress row.
- `npm run sim -- shot '/(tabs)/(library)/mastered' --as reader-a`: John 3:16 with "Review now", the sort pill on "Due first", and no + button.
- `npm run sim -- flow account-translation`: reader-a switches to KJV on the add screen; cards follow, mastery stays.
- After a local reset, `npm run sim -- flow library-plus`: the + menu, Share… with the invite opened by link over it and Open, then the Library tab pops to the Library and + still opens; New shared collection lands on the code; Join with code.
- After a local reset, `npm run sim -- flow library-management`: rename, drag and reopen the saved order, copy from Mastered, remove the copy, and inspect swipe Delete in both themes.
- Tap path: open My Verses, tap the sort pill to Mastery, force-quit and reopen. It's still Mastery.

## Decisions

- 2026-04-27 · Sort is per collection, not one global setting · The user preferred it that way, and the database cost is small.
- 2026-04-27 · Real collections save sort in the database, virtual ones in AsyncStorage · Virtual collections have no row to hold it.
- 2026-04-28 · Recent means last practiced, stored on `user_verses.last_practiced_at` · Joining `session_attempts` on every render is too slow, and `engraved.lastReviewedAt` doesn't cover unmastered verses.
- 2026-04-28 · `last_practiced_at` is per verse, not per collection, with no backfill · Per collection would thread `collectionId` through the study loop and needs a special case for virtual collections. Verses float as they're practiced.
- 2026-04-28 · Never-practiced verses sort after practiced ones · Recently practiced work floats to the top, and new verses queue below.
- 2026-04-28 · Mastered defaults to Due first, and every other collection to Recent · Due first is the useful view for reviewing.
- 2026-11-12 · One `delete_verse` call, not four requests · A failure partway left a verse in no collection.
