# Library and Collections

> **Status: Living document.** Update when collection or verse
> CRUD semantics change, when the verse-add gesture changes, or
> when swipe actions change. Read before touching
> `app/(tabs)/(library)/`, `components/library/`, or any
> `lib/storage/` collection/verse function.

The Library tab is where users organize their saved verses. The
data model is many-to-many: one verse can belong to multiple
collections. The deletion semantics are nuanced — see below.

## Data model

Three tables (full schema in
`docs/architecture/data-model.md`):

```
user_collections (id, user_id, name, is_default, deleted_at)
       ↑
       │ collection_id
       │
verse_collections (verse_id, collection_id, added_at)   ← junction
       │
       │ verse_id
       ↓
user_verses (id, user_id, book, chapter, verse_start, verse_end,
             version, progress, deleted_at)
```

A verse stored once, referenced from many collections. Deleting a
collection removes its junction rows; deleting a verse from a
collection removes the junction (and possibly the verse itself —
see deletion semantics below).

## Routes

| Route | Purpose |
|---|---|
| `(tabs)/(library)/index.tsx` | Library list — collections + their verses |
| `(tabs)/(library)/[id].tsx` | Collection detail — verses in this collection |
| `(tabs)/(library)/add.tsx` | Create new collection |
| `(tabs)/(library)/add/[book]/[chapter].tsx` | Pick verses to add (from a chapter) |
| `(tabs)/(library)/setup/[id].tsx` | Pre-session: pick difficulty + chunk size |

## The "My Verses" default collection

- Constant: `DEFAULT_COLLECTION_ID = 'my-verses'` in `lib/store/index.ts`.
- Server row has `is_default: true`.
- **Cannot be deleted.** Three layers of guard:
  1. UI: `SwipeableCollectionCard` disables swipe when `isDefault`.
  2. Store: `deleteCollection(id)` returns early if `id === DEFAULT_COLLECTION_ID`.
  3. (No server-side guard. The first two are enough in practice.)
- Auto-created if missing: when `addVerse()` is called without a
  collection, it creates "My Verses" if none exists.

## The "Mastered" virtual collection

- Constant: `MASTERED_COLLECTION_ID = 'mastered'`.
- **No row exists in `user_collections`.** It's a client-side
  synthesis.
- Populated by `fetchMasteredVerses()` — pulls verses where
  `progress->hard->completed = true`, regardless of `deleted_at`.
- Cannot be deleted (no-op in store).
- Cannot be added to directly (mastery is the only way in).
- The Mastered detail screen has a `due-first` sort option (added by
  the review-system feature) that sorts by ascending
  `daysUntilDue` so verses that are due for SR review rise to the
  top. Selectable from the existing sort cycle:
  Recent → A-Z → Mastery → Due first.

## The "In Progress" virtual collection

- Constant: `IN_PROGRESS_COLLECTION_ID = 'in-progress'`.
- **No row exists in `user_collections`.** Client-side synthesis,
  parallel to Mastered.
- Populated by `useInProgressVerses()` — any verse with non-null
  `bestAccuracy` on any difficulty AND `!hard.completed`, deduped
  by verse id. Lenient: any practice puts the verse in progress.
- Hidden from the Library list when the count is zero.
- Cannot be deleted, cannot be added to directly, swipe-to-delete
  on individual verses is disabled (verses live in real
  collections; this is just a view).
- Does **not** participate in SR scheduling — In Progress means
  "still learning," distinct from Mastered's "needs review."
- The Insights "Verses in progress" count and the Library
  In Progress collection size are sourced from the same
  `isInProgressVerse` predicate; they are guaranteed equal.

> **If you query `user_collections` and use the result in client
> code, remember to inject the virtual `mastered` and (when
> `useInProgressVerses().length > 0`) `in-progress` entries.**
> Both are added in `getCollections()` in `lib/storage/index.ts`
> and `fetchCollections` in `lib/store/index.ts`.

## Adding a verse — multi-select gesture

`app/(tabs)/(library)/add/[book]/[chapter].tsx` is one of the most
sophisticated gesture surfaces in the app. The flow:

1. **Long press (≥250ms)** on a verse → start range selection,
   haptic feedback.
2. **Drag** while held → extend the selection range. Auto-scrolls
   when near edges.
3. **Quick tap (<250ms)**:
   - If nothing selected → single-verse selection.
   - If something selected → deselect all.
4. **Touch move >10px** during the long-press wait window → cancels
   the long press (treated as a scroll, not a selection).
5. Selection state: `selectionStart` and `selectionEnd` (verse
   numbers). The selection is always contiguous.
6. **Add button** calls `handleAddVerses()` which iterates the
   range and calls `useAppStore.addVerse(...)` for each verse.

This isn't accidental complexity — it's how a user grabs "John
3:16-18" in a single fluid motion. Don't simplify it without a
real reason.

## Verse `addVerse` semantics

Where the heavy lifting lives — `lib/store/index.ts` →
`lib/storage/index.ts`:

```
addVerse(verse, collectionId, version)
  │
  ├── Check if a row already exists for
  │   (user_id, book, chapter, verse_start, verse_end, version)
  │
  ├── If exists AND active:
  │     ensure junction row in verse_collections (upsert)
  │     update Zustand
  │
  ├── If exists AND soft-deleted:
  │     restore (clear deleted_at)
  │     ensure junction row
  │     update Zustand
  │
  └── If not exists:
        insert new user_verses row
        insert junction row
        update Zustand
```

The unique index on `user_verses` is partial
(`WHERE deleted_at IS NULL`), so a soft-deleted row doesn't block
a re-add. The storage layer detects the existing soft-deleted row
and restores it instead of inserting a duplicate.

## Verse deletion semantics

The trickiest logic in the data layer. From a collection's UI,
deleting a verse means:

```
deleteVerse(verseId, collectionId)
  │
  ├── Remove junction (verse_collections row for this collection)
  │
  ├── If verse is in OTHER collections:
  │     Done. Verse stays active in those.
  │
  ├── If verse is in NO other collections AND mastered (progress.hard.completed):
  │     Soft-delete (set deleted_at = NOW()).
  │     Verse stays in the `mastered` virtual collection forever.
  │
  └── If verse is in NO other collections AND NOT mastered:
        Hard-delete (DELETE FROM user_verses).
        Junction rows cascade.
        session_attempts rows survive (no FK).
```

The UI `SwipeableVerseCard.tsx` shows a context-aware confirmation:

| Situation | Action label | What happens |
|---|---|---|
| In other collections | "Remove from collection" | Junction-only delete |
| Mastered, only here | "Remove from collection" | Soft-delete; stays in Mastered |
| Not mastered, only here | "Delete verse" | Hard-delete |
| In Mastered collection view | (swipe disabled) | — |

The Mastered collection itself never lets you swipe-delete — you
can't un-master a verse from there. To actually remove a mastered
verse, the user has to use `resetVerseProgress()` from the verse
detail page (which clears `progress.hard.completed`, demoting it
out of Mastered).

## Collection deletion

```
deleteCollection(id)
  │
  ├── Block if id === DEFAULT_COLLECTION_ID or MASTERED_COLLECTION_ID
  │
  ├── Soft-delete user_collections row (set deleted_at)
  │
  └── For each verse in this collection:
        Apply the deleteVerse logic above
        (some get soft-deleted, some hard-deleted, some just lose this junction)
```

The user sees one swipe action; behind the scenes it can fan out
to many writes. If any partway fails, the local state is rolled
back optimistically — but the server state may be partially
applied.

## Sorting

Collection detail (`[id].tsx`) sorts verses *locally* — sort order
is not persisted:

- **Recent** (default): by `createdAt` descending.
- **A–Z**: by `formatVerseReference()` alphabetically.
- **Mastery**: highest difficulty completed first
  (engraved > hard > medium > easy > none).

Collections themselves display in `created_at` order from the DB.
There's no UI to reorder collections.

## Components

| File | Purpose |
|---|---|
| `components/library/CollectionCard.tsx` | One collection in the Library list |
| `components/library/SwipeableCollectionCard.tsx` | Wraps CollectionCard with swipe-to-delete |
| `components/library/SwipeableVerseCard.tsx` | Verse row with swipe-left delete |
| `components/library/VerseList.tsx` | Verse list inside a collection |
| (others — see `components/library/`) | Add modal, filter chips, etc. |

## Invariants

1. **Verse uniqueness is `(user_id, book, chapter, verse_start,
   verse_end, version)`** — partial-unique on active rows. Don't
   try to add a row that violates this.
2. **The default collection cannot be deleted.** Three guard layers
   in the UI / store. Don't add bypasses.
3. **The Mastered collection is virtual.** No DB row, no
   `collection_id` you can store anywhere. It's synthesized in
   `getCollections()` and only contains verses where
   `progress.hard.completed = true`.
4. **Mastery is permanent unless explicitly reset.** Soft-delete
   on a mastered verse keeps it in Mastered. Only
   `resetVerseProgress` removes it.
5. **Verse deletion logic depends on `progress.hard.completed`.**
   If `progress` is malformed for some reason, you'll hard-delete
   a mastered verse. The default-progress shape in
   `lib/store/index.ts` is the contract.
6. **Junction-table writes go through `lib/storage/`.** Don't
   insert into `verse_collections` directly from a component.

## Sharp edges

- **Re-adding a soft-deleted verse restores the original row.**
  This is intentional (preserves mastery) but can be confusing —
  the "new" verse already has progress.
- **A collection-delete is a fan-out write.** Partial failure is
  possible. Optimistic rollback exists locally but the server can
  end up half-applied.
- **`mastered` and `in-progress` are client-side only.** If you
  write code expecting every collection ID to map to a
  `user_collections` row, you'll blow up on either of them.
- **Multi-select gesture is fragile.** It uses long-press timing,
  drag distance thresholds, and auto-scroll. Don't refactor
  carelessly.
- **No reordering.** Verses sort locally, not persistently.
  Collections show in DB order. Adding reordering means a new
  `position` column.
