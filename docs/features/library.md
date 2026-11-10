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
| `index.tsx` | Collection list, pull to refresh, Edit, and + to create |
| `[id].tsx` | One collection: search, sort pill, verse list, + to add, and long press to copy |
| `add.tsx` | Pick a version, book and chapter. Passes `collectionId` along |
| `add/[book]/[chapter].tsx` | Read the chapter and select a verse range |
| `setup/[id].tsx` | Study setup and Reset Progress. See `docs/features/study-session.md` |

Collections and verses open by `client_id`, so `/(tabs)/(library)/mastered` works the
same as a real collection. Notification taps use that path
(`docs/features/notifications.md`).

## Collections

`fetchCollections` pins My Verses, Mastered and In Progress. Custom collections
follow saved positions, then creation time and client ID. New collections append.

Long-press a custom collection for Rename, Reorder and Delete. Rename prefills
`AddCollectionModal`. Reorder or Edit reveals drag handles with accessibility
actions to move up or down. Each drop saves the order, with rollback on failure.

**My Verses** is the default. Its `client_id` is `my-verses`, with `is_default` true.

- It's created lazily by `addVerse`, `copyVerseToCollection` or `updateCollectionSort`, with `created_at`
  at the epoch so it sorts first. Until then `fetchCollections` adds a local
  `DEFAULT_COLLECTION`.
- Its name and position are fixed in the app. `SwipeableCollectionCard` disables
  its delete action, and the store's `deleteCollection` returns early.
- `addVerse` falls back to it if the requested collection isn't found.

**Mastered** has the ID `mastered` (`MASTERED_COLLECTION_ID`).

- It holds verses where `progress.hard.completed` is true, including soft-deleted ones.
- Mastery is the only way in. `isVirtual` removes the + button, and
  `AddToCollectionModal` filters virtual collections out.
- Swipe is disabled on its rows. The only way out is Reset Progress on the setup
  screen.
- The list row shows `DueCountPill` from `useDueCounts`. Due and engraved rules are in
  `docs/features/review.md`.

**In Progress** has the ID `in-progress` (`IN_PROGRESS_COLLECTION_ID`).

- It holds verses matching `isInProgressVerse`: any non-null `bestAccuracy` on any
  difficulty, and not mastered on Hard. `useInProgressVerses` dedupes by `id`.
- The Insights count uses the same predicate, so the two match
  (`docs/features/insights.md`).
- The push nudge mirrors it on the server, and the two must change together
  (`docs/features/notifications.md`).
- `index.tsx` hides the row when the count is zero. `fetchCollections` always includes
  it, so check for it before you assume the store's list is what's on screen.
- It has no + button and no swipe. Verses live in real collections, and this is a view.
- It isn't part of review scheduling.

## Sorting verses

The pill on `[id].tsx` cycles through the options in `cycleSort`, in
`lib/store/library-sort.ts`. Only Mastered has Due first.

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
rolls back and shows a toast. `updateCollectionSort` creates the My Verses row if it
doesn't exist yet, so a preference set before the first verse survives a restart. The
two AsyncStorage values survive sign-out, because `clear` doesn't touch them.
`parseSortPreference` treats an unknown value as no preference.

**`last_practiced_at`** (migration `016_sort_and_last_practiced.sql`) is per verse. The
store's `updateVerseProgress` writes it on every completed session, full or partial,
whether or not the score improved. Practicing a verse floats it under Recent in every
collection it's in. `resetVerseProgress` clears it. The column was never backfilled.

Sorting and search run in JS on the in-memory list, with no database index. Search on
`[id].tsx` is `filterVerses` in `lib/search.ts`, which matches a book prefix, then
chapter and verse.

## Adding a verse

`add.tsx` is a book and chapter list with a version picker. The chapter screen loads
with `fetchChapter`, and the user selects one continuous range:

1. **Long press, 250 ms.** Starts a selection, with a haptic.
2. **Drag while held.** Extends the range. It auto-scrolls within 60 points of the edge.
3. **Moving more than 10 points during the wait.** Cancels the long press, so it scrolls
   instead.
4. **Quick tap.** With nothing selected it selects one verse. With a selection it clears
   the selection.
5. **Add.** `handleAddVerses` makes one `addVerse` call with `verseStart` and `verseEnd`,
   so a range is a single saved verse. Then it returns to the collection, or to the
   Library if none was given.

This gesture is how someone grabs John 3:16-18 in one motion. It depends on timing,
distance thresholds and auto-scroll together, so test on a device after any change.

`AddToCollectionModal`, on Home and Insights, also goes through `addVerse`.

`addVerse` in `lib/store/index.ts` looks for a row with the same user, book, chapter,
range and version, including soft-deleted ones:

| Existing row | What happens |
|---|---|
| Active | Upsert the junction row, ignoring duplicates |
| Soft-deleted | Clear `deleted_at`, then upsert the junction row. Progress comes back |
| None | Insert the verse with `DEFAULT_PROGRESS`, then the junction row |

Verse identity is the partial unique index `idx_user_verses_unique_verse` from
`006_verse_collections_junction.sql`, on active rows only. The restore path is what
stops duplicates, so a soft-deleted row never blocks a re-add.

## Copying a saved verse

Long-press a verse for Copy to collection. Choose My Verses or a custom collection.
Already added destinations are disabled. A failed copy keeps the picker open.

`copyVerseToCollection` adds one membership for the existing verse, so it stays
in the source collection and shares its version, progress and study preferences.
A soft-deleted verse copied from Mastered is restored as part of the same write.
See `docs/architecture/data-model.md` for the database operations.

## Versions and KJV offline

The version is part of a saved verse's identity, so John 3:16 in ESV and in KJV are two
verses. The add screens start from the user's Bible version and can switch.

KJV is public domain and ships in the app, so reading a saved KJV verse needs no network
and costs no API quota. Other versions need a connection unless already cached. Only
reading is offline: saving verses and recording progress still need the network
(invariant 10, `docs/architecture/sync-and-storage.md`). The bundle itself is in
`docs/architecture/bible-api-and-caching.md`.

## Deleting a verse

`deleteVerse(id, collectionId)` in the store removes the verse from the store first, then:

1. Removes the junction row for this collection.
2. If other collections still hold the verse, stops.
3. If none do and the verse is mastered, soft-deletes it. It stays in Mastered.
4. If none do and it isn't mastered, hard-deletes it. Junction rows cascade.
   `session_attempts` rows survive, since they have no foreign key to the verse.

A failed lookup or junction delete restores the local list and rethrows. A failure
writing step 3 or 4 is only logged.

`SwipeableVerseCard` picks its confirmation text from the same facts, using
`collectionCount` from `[id].tsx`:

| Situation | Title | Result |
|---|---|---|
| In other collections | Remove from collection? | Only this junction row goes |
| Only here, mastered | Remove from collection? | Soft delete, stays in Mastered |
| Only here, not mastered | Delete verse? | Hard delete, progress is lost |

## Deleting a collection

Swipe a custom collection or a verse in a real collection left to reveal Delete.
The same inset action opens the confirmation on both types of card. Collection
actions also offer Delete on long press.

The store's `deleteCollection` returns early for My Verses. It then finds the row and,
for each verse, applies the same rule as above: remove the junction, and soft-delete or
hard-delete if no other collection holds it. Last it sets `deleted_at` on the collection
and updates local state. The virtual collections never get here, because the card
disables their swipe. If they did, the row lookup would throw `Collection not found`.

One swipe can fan out to many writes, one verse at a time, with no transaction and no
optimistic update.

## Reset progress

`resetVerseProgress(id)` in the store sets `progress` to `DEFAULT_PROGRESS` and clears
`last_practiced_at`. It's reached from Reset Progress on `setup/[id].tsx`. It's the only
way a verse leaves Mastered.

## Invariants

1. Verse identity is user, book, chapter, range and version, unique among active rows.
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

- **`lib/storage` and `lib/sync` hold older copies.** `deleteCollection`, `deleteVerse` and
  `saveVerse` in `lib/storage/index.ts` are only called from `lib/sync`, and the app imports
  nothing from `lib/sync`. The older `deleteCollection` moves verses to My Verses, which is
  the opposite of what the store does. Use the store actions.
- **Adding a verse already in the collection duplicates it locally.** `addVerse` always
  prepends to `verses`, even when the junction upsert did nothing. The verse shows twice,
  with a duplicate list key, until the next fetch. Restored verses also lose
  `lastPracticedAt` in that local entry until then.
- **Reset on a soft-deleted mastered verse doesn't update the Mastered list.**
  `resetVerseProgress` works out `wasMastered` from `verses` alone, and such a verse is only
  in `masteredVerses`. It stays listed with old progress until the next fetch. After that the
  row stays soft-deleted, in no list, until the user re-adds it.
- **A failed collection delete can leave partial writes.** The per-verse writes don't check
  errors. Only the final collection update throws, and by then verses may already be gone
  while the local state is unchanged.
- **Re-adding a soft-deleted verse restores it.** That's intended, because it preserves
  mastery, but a "new" verse can arrive with progress.
- **The chapter screen needs a connection even for KJV.** `[chapter].tsx` checks `NetInfo`
  before `fetchChapter` and shows "No Internet Connection", although KJV could load from the
  bundle.
- **A-Z isn't numeric.** `localeCompare` on the reference puts John 10 before John 3.
- **The empty hint never shows.** `index.tsx` renders it at `collections.length <= 1`, but My
  Verses and Mastered are always present once hydrated.

## Browser checks

- `npm run sim -- shot '/(tabs)/(library)' --as reader-a`: My Verses, Mastered with a "1 due" pill, In Progress, and Psalms.
- `npm run sim -- shot '/(tabs)/(library)' --as reader-b`: My Verses and Mastered only, with no In Progress row.
- `npm run sim -- shot '/(tabs)/(library)/mastered' --as reader-a`: John 3:16 with "Review now", the sort pill on "Due first", and no + button.
- `npm run sim -- flow add-verse`: reader-b opens the empty My Verses, adds Ruth 1:1 (ESV, from the local `bible` function) with a quick tap, sees the card, then swipes it away with Delete, back to "No verses yet".
- After a local reset, `npm run sim -- flow library-management`: rename, drag and reopen the saved order, copy from Mastered, remove the copy, and inspect swipe Delete in both themes.
- Tap path: open My Verses, tap the sort pill to Mastery, force-quit and reopen. It's still Mastery. Then +, a book, a chapter, long-press and drag across three verses, Add. One new card shows the range.

## Decisions

- 2026-04-27 · Sort is per collection, not one global setting · The user preferred it that way, and the database cost is small.
- 2026-04-27 · Real collections save sort in the database, virtual ones in AsyncStorage · Virtual collections have no row to hold it.
- 2026-04-28 · Recent means last practiced, stored on `user_verses.last_practiced_at` · Joining `session_attempts` on every render is too slow, and `engraved.lastReviewedAt` doesn't cover unmastered verses.
- 2026-04-28 · `last_practiced_at` is per verse, not per collection, with no backfill · Per collection would thread `collectionId` through the study loop and needs a special case for virtual collections. Verses float as they're practiced.
- 2026-04-28 · Never-practiced verses sort after practiced ones · Recently practiced work floats to the top, and new verses queue below.
- 2026-04-28 · Mastered defaults to Due first, and every other collection to Recent · Due first is the useful view for reviewing.
