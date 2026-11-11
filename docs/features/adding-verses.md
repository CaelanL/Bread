# Adding verses

How verses get into a collection: the add screen reached from a collection's +, with
the quick-add field on top and the book and chapter list below it. Collections and the
rest of the Library are in `docs/features/library.md`.

## Browsing a chapter

`add.tsx` is the quick-add field over a book and chapter list, with the account
translation picker in the header. Tapping a chapter opens `add/[book]/[chapter].tsx`,
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
path means a soft-deleted row never blocks a re-add.

## Quick add

The field at the top of `add.tsx` is `components/library/QuickAddField.tsx`. The parser is
`parseQuickAdd` in `lib/bible/quick-add.ts`, pure and unit-tested. It reparses the whole
field text on every keystroke.

- **Book.** Matches by prefix over `BIBLE_BOOKS` with spaces ignored, so `1t` and `1 t` offer
  1 Thessalonians and 1 Timothy, or by an exact `BOOK_ALIASES` key (`gn`, `jn`). Up to five
  suggestion rows show, the typed part tinted. Tapping one, or a space or digit typed after a
  book with one match, rewrites the field to the full name (`completeBook`).
- **Numbers.** The first run of anything that isn't a letter or digit splits chapter and
  verse. Only a dash before a third number makes a range. Counts come from `getChapterCount`
  and `getVerseCount`.
- **Enter.** Takes the top suggestion while the book is unsettled, otherwise turns the
  reference into a chip and clears the field. The keyboard stays up. A chapter alone adds
  nothing; the hint says how many verses it has.
- **Chips.** Green is ready. Red is out of range, a reversed range or a range across chapters;
  the hint line lists why. Grey "already here" is a verse already in the collection, worked
  out from the store, never sent. The same reference twice makes one chip. Long-press a green
  or grey chip to read it in `VerseExpandModal` through `fetchVerse`.
- **Add N.** Calls `addVerse` once per green chip, in order. Each saved chip leaves at once.
  When all saved it goes back to the collection like the chapter screen; otherwise it stays
  with the failed chips and one toast names the first failure.

While the field has text the book list dims and stays tappable. Chips live in the
component and go when the screen is popped.

## Double taps

`useDebouncedPress` guards the chapter grid and the collection's +. The chapter grid uses
one hook instance, so every chapter shares one 500 ms window and a quick tap on a second
chapter is ignored too. Book rows open in place, so `handleBookPress` in `add.tsx` ignores
only a re-tap of the same book inside 500 ms; a quick tap on another book goes through.
Dragging the book list closes the keyboard; tapping a book or chapter keeps it up.

## Sharp edges

- **Adding a verse already in the collection duplicates it locally.** `addVerse` always
  prepends to `verses`, even when the junction upsert did nothing. The verse shows twice,
  with a duplicate list key, until the next fetch. Restored verses also lose
  `lastPracticedAt` in that local entry until then.
- **The chapter screen needs a connection even for KJV.** `[chapter].tsx` checks `NetInfo`
  before `fetchChapter` and shows "No Internet Connection", although KJV could load from the
  bundle.

## Browser checks

- `npm run sim -- flow add-verse`: reader-b uses the shared picker, adds bundled KJV Ruth 1:1 with a tap, sees the card, then deletes it back to "No verses yet".
- `npm run sim -- flow quick-add`: reader-b picks Ruth from a suggestion, makes Ruth 1:1, Ruth 2:1-2 and a red John 22:1, peeks a chip, taps Add 2, sees both KJV cards, then deletes them.
- `npm run sim -- flow add-double-tap`: a quick tap on a second book opens it; reader-b double-taps Ruth and its chapter 1, Ruth stays open and one Back returns to the add screen.
- Tap path: +, a book, a chapter, long-press and drag across three verses, Add. One new card shows the range.

## Decisions

- 2026-11-11 · Book matching is prefix or an exact known abbreviation, never fuzzy · misspellings were out of scope; `gn` works because it's in `BOOK_ALIASES`.
- 2026-11-11 · Only a dash makes a range, and one saved verse stays inside one chapter · Caelan: "then you need a dash".
- 2026-11-11 · Add returns to the collection once every chip saved · same as the chapter screen.
- 2026-11-11 · Book rows ignore only a quick re-tap of the same book, chapters share one window · a book row stays on screen, so a fast tap on another book is a real choice; a chapter tap leaves the screen.
- 2026-11-11 · The Add pill sits in the field row, not the header · the header holds the account translation picker.
