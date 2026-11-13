# Adding verses

How verses get into a collection: the add screen reached from a collection's +, with
the quick-add search field on top and the book and chapter list below it. Collections and the
rest of the Library are in `docs/features/library.md`.

## Browsing a chapter

`add.tsx` is the quick-add field over a book and chapter list (Browse, below), with the account
translation picker as a pill in the bar. Tapping a chapter opens `add/[book]/[chapter].tsx`,
which loads with `fetchChapter`, and the user selects one continuous range:

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

## Verse identity

`addVerse` in `lib/store/index.ts` looks for rows with the same user, book, chapter
and range in any version, including soft-deleted ones:

| Existing row | What happens |
|---|---|
| Active | Upsert the junction row, ignoring duplicates |
| Soft-deleted only | Restore the best one (version rule in `bible-versions.md`), then the junction row |
| None | Insert the verse with `DEFAULT_PROGRESS`, then the junction row |

A verse is one row per reference (`bible-versions.md`). The restore
path means a soft-deleted row never blocks a re-add. The local card carries the row's last
practiced time and study choices, and adding a verse the collection already holds keeps the
one card it has.

## Quick add

The field at the top of `add.tsx` is `components/library/QuickAddField.tsx`. The screen has
two modes, like an iOS search controller, and they never share the screen:

- **Browse.** The field isn't focused. The book and chapter list shows under it, as above.
- **Search.** Focusing the field lifts it to the top: the bar (back, the translation pill) and
  the "Add verses" title over "to <collection>" slide up and fade, the book list fades out, Cancel
  sits right of the field and only suggestion rows show. Cancel clears the field, drops focus and
  plays it back. Dismissing the keyboard any other way stays in Search. Reduced motion: no lift,
  fades only.

There's no hint text, only the field's "Search" placeholder.

### Rows

`quickAddRows` in `lib/bible/quick-add.ts` turns the field text into at most six rows, top row
first. It's pure and unit-tested, and reparses the whole text with `parseQuickAdd` on every
keystroke.

| Field | Rows |
|---|---|
| `R` | Matching books: Ruth, Romans, Revelation, in Bible order. Each fills `Romans ` |
| `Romans ` | Romans 1 to Romans 6, each filling the field |
| `Romans 8` | Romans 8:1 to 8:6, each filling `Romans 8:1` |
| `Romans 8:1` | Romans 8:1 on top, then 8:1-2 up to 8:1-6, all adds |
| `Romans 8:1-4` | That range alone, as an add |
| `Romans 8:28-3` | An end still being typed: the ranges it can become, 8:28-30 up to 8:28-35, all adds |
| `Jude 24`, `Jude 3-5` | A one-chapter book (Obadiah, Philemon, 2 John, 3 John, Jude) takes a lone number or range as verses: Jude 1:24 and 1:24-25 |
| No match, a chapter or verse outside the book, a reversed range no end can complete (`Romans 8:28-27`), a range across chapters | None |

- **Fill rows** end in an up-left arrow (`arrow.up.left`) and rewrite the field, so the next
  rows narrow. **Add rows** end in a plus.
- **Return** takes the top row, which is highlighted. So `rom`, Return, `8`, Return, Return
  adds Romans 8:1.
- **Book matching** is prefix over `BIBLE_BOOKS` with spaces ignored, so `1t` and `1 t` offer
  1 Thessalonians and 1 Timothy, or an exact `BOOK_ALIASES` key (`gn`, `jn`). A space or digit
  typed after a book with one match rewrites it to the full name (`completeBook`).
- **Numbers.** The first run of anything that isn't a letter or digit splits chapter and verse,
  so `Rom 8 28` works. Only a dash before a third number makes a range. Counts come from
  `getChapterCount` and `getVerseCount`.
- **No whole-chapter row.** Nothing adds a whole chapter today, so a bare chapter offers its
  first verses instead.
- **Empty field.** Up to six recent references from the store's verses, newest `createdAt`
  first, leaving out ones already in this collection, under "Recent". It's derived, never
  stored. These wait for a tap: Return on an empty field does nothing.

### Adding

An add row calls `addVerse` once, the same store action, account translation and verse identity
as the chapter screen. No verse text is read. The field clears and the keyboard stays up. On
success a toast says "Added Romans 8:1" with Undo for 4 seconds; Undo calls `deleteVerse` for
that verse in this collection. A failed add or undo shows its error in the same toast, since the
app's global error toast sits under the keyboard. A shared collection's own refusal (the
200-verse cap) shows as written, through `sharedErrorMessage`. The toast rides above the keyboard
(`KeyboardStickyView`), and Cancel dismisses it.

A reference already in the collection, worked out from the store, shows "Already in this
collection" in place of the plus, and tapping it or Return does nothing. A reference already
being saved is ignored too, so a double tap adds once. The screen stays open after an add;
Back returns to the collection.

## Double taps

`useDebouncedPress` guards the chapter grid and the collection's +. The chapter grid uses
one hook instance, so every chapter shares one 500 ms window and a quick tap on a second
chapter is ignored too. Book rows open in place, so `handleBookPress` in `add.tsx` ignores
only a re-tap of the same book inside 500 ms; a quick tap on another book goes through.

## Sharp edges

- **The chapter screen needs a connection even for KJV.** `[chapter].tsx` checks `NetInfo`
  before `fetchChapter` and shows "No Internet Connection", although KJV could load from the
  bundle.

## Browser checks

- `npm run sim -- flow add-verse`: reader-b uses the shared picker, adds bundled KJV Ruth 1:1 with a tap, sees the card, then deletes it back to "No verses yet".
- `npm run sim -- flow quick-add`: reader-b focuses the field (books hidden, Cancel shown), types `rom`, Return, `8`, Return, taps Romans 8:1-4, sees "Added Romans 8:1-4", Undo, then adds Romans 8:1 with Return, sees "Already in this collection" for it, Cancel shows the books, and the card is deleted from My Verses.
- `npm run sim -- flow add-double-tap`: a quick tap on a second book opens it; reader-b double-taps Ruth and its chapter 1, Ruth stays open and one Back returns to the add screen.
- Tap path: +, a book, a chapter, long-press and drag across three verses, Add. One new card shows the range.

## Decisions

- 2026-11-11 · Book matching is prefix or an exact known abbreviation, never fuzzy · misspellings were out of scope; `gn` works because it's in `BOOK_ALIASES`.
- 2026-11-11 · Only a dash makes a range, and one saved verse stays inside one chapter · Caelan: "then you need a dash".
- 2026-11-11 · Book rows ignore only a quick re-tap of the same book, chapters share one window · a book row stays on screen, so a fast tap on another book is a real choice; a chapter tap leaves the screen.
- 2026-11-12 · Quick add is a search mode with immediate adds, no chips · Caelan found chips over the book list incoherent.
- 2026-11-12 · Recent rows and Return on an empty field add nothing until tapped · Return on an empty field shouldn't add a verse the user didn't type.
