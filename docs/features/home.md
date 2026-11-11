# Home and Verse of the Month

Home is the first tab. It shows the Verse of the Month (VOTM), a global monthly challenge, `InsightsCard`, a shortcut to the Insights screen, and an Explore collections preview.

| File | Purpose |
|---|---|
| `app/(tabs)/home.tsx` | Loads VOTM data and composes the screen |
| `components/home/VOTMCard.tsx` | The VOTM card |
| `components/home/ExploreCollections.tsx` | Two curated collections and a See all link to `/explore` |
| `components/home/InsightsCard.tsx` | Streak, mastered and in-progress counts. Tap opens `/insights` |
| `lib/api/votm.ts` | `getCurrentVOTM`, `getVOTMMasteryCount`, `hasUserMasteredVOTM` |

What those numbers mean is in `docs/features/insights.md`.

## Explore collections

Home groups the Explore heading and two suggested collections on one
surface. See all opens the full catalog. These cards use bundled artwork
and passage counts, so browsing does not fetch Bible text.

An introduction lists tappable references. It preloads the first two
passages through `fetchVerse`, then the expanded passage and its next
neighbor, sequentially. Pending and successful reads are shared in memory
for the selected translation. Version changes and unmount stop further
preloads and ignore stale preview results. Failed reads remain retryable.
Text expands on tap in the app's system font. The introduction shares the top-right
`BibleTranslationPicker` with verse selection. Its scrollable list reads
`BIBLE_VERSIONS`. The selection starts from the user's setting and applies
to this preview and import. Before writing, the store verifies all
requested keyed verses. An incomplete read lets the user retry or choose
another translation. The centered Add collection action uses an intrinsic
width and a minimum 44-point touch target.

`importCuratedCollection` saves every passage in one transaction and reads
back the resulting collection. Matching references in the same translation
share progress and study preferences. The same catalog and translation
opens the edited copy, while another translation creates a distinct copy.
The translation appears on the saved verses. Explicitly adding a deleted
copy restores its passages and eligible progress at the end of the
Library. A failed readback after saving offers Refresh Library.

The import migration adds a nullable icon key and allows the translation
codes Bread supports. Custom icons sync with the account. Missing and
unknown icons render the Bible symbol. Built-in collection icons are fixed.

### Community saves

Home, Explore and introductions show all-time unique accounts that saved each
curated collection. A first successful import contributes once across translations.
Editing, emptying, renaming, deleting or re-adding the personal copy leaves that
contribution unchanged. This is not a count of current copies or completed passages.

`curated_collection_savers` stores only a surrogate ID, catalog ID and nullable
user ID. Account deletion sets that user link to NULL, retaining an anonymous
contribution. Totals use `COUNT(*)`, including these anonymous rows. Clients cannot
read or write ledger rows. The import transaction calls a private, owner-checking
writer; `get_curated_collection_saver_counts` exposes bounded aggregate reads only.
The migration backfills exact known import identities, including soft-deleted
copies, deduplicated across versions; ordinary collections with similar names do
not count.

`curatedSaverCounts` in the app store shares successful reads across these screens.
Focus, app return and pull to refresh fetch authoritative totals. A committed import
starts a non-blocking count refresh before Library readback. Loading/failure omits
an unknown number and retains a previously successful total on refresh failure.
There is no optimistic increment. Requests are account-scoped, ignore older reads,
and abort when their screen loses focus. Counts do not block browsing or saving.

When adding a catalog entry, update `private.curated_catalog_ids` through an additive
migration alongside the client catalog. `curated-savers-catalog.test.mjs` checks
parity. A new translation uses the same catalog contribution and needs no count ID.

## Loading

`fetchVOTM` in `home.tsx` runs on mount and whenever `bibleVersion` changes. Pull to refresh runs it too, along with the store's `refresh()` and the card's streak refresh.

1. `getCurrentVOTM` builds `YYYY-MM` from the device's local clock and selects that row from `verse_of_month`.
2. If there is a row, `getVOTMMasteryCount` and `hasUserMasteredVOTM` run in parallel.
3. `getVerseText` then fetches the text in the user's current version. See `docs/architecture/bible-api-and-caching.md`.

The skeleton stays up until all of that finishes. If there is no row, Home shows "No verse of the month yet." and "Check back soon!". If the text fails, Home shows a toast and the card reads "Unable to load verse text".

## `verse_of_month`

Defined in `supabase/migrations/007_verse_of_month.sql`, with `image_url` added in `008_votm_image.sql`.

- `year_month` is unique text like `2026-11`.
- A row holds a reference: book, chapter, verse start and end. There is no version column.
- Anyone can read it, signed in or not. No write policy exists, so rows are added with the service role.

`image_url` is free-form text. The bucket line in migration 008 is a comment, so no migration creates a storage bucket.

## The card

- **Text.** Three lines at most, in the user's `bibleVersion`, with the version shown beside the reference.
- **Image.** With `image_url`, `expo-image` draws it behind a dark overlay and the text turns white.
- **Count.** "N people have mastered", from `getVOTMMasteryCount`.
- **User status.** One of these, in this order:

| Condition | Shows |
|---|---|
| `hasUserMasteredVOTM` is true: a row of theirs with the same range and `hard.completed`, in any version, soft-deleted included | "Mastered" |
| The same range is in `verses`, in any version | "In Library" |
| Otherwise | "Add to Library" button |

**Tapping.** The card opens `VerseExpandModal`. It does not start a session. "Add to Library" on the card, or the add button in the modal, opens `AddToCollectionModal`.

## Rules

1. **VOTM is keyed by `year_month` from the local clock.** Don't switch to UTC without working through the rollover hour.
2. **VOTM has no version.** The reference is global, and the translation follows the user's setting.
3. **Mastery checks ignore version.** Everyone is working on the same verse, so any function behind the count must not filter by version.
4. **`verse_of_month` is admin-write only.** No client should insert.

## Sharp edges

- **`get_votm_mastery_count` doesn't exist in the repo. This is a bug.** `getVOTMMasteryCount` calls it with `p_book`, `p_chapter`, `p_verse_start` and `p_verse_end`, but no file in `supabase/` defines it, including `supabase/migrations/` and `supabase/database.types.ts`. On a database built from the migrations the call errors, `getVOTMMasteryCount` logs it and returns 0, and the card reads "0 people have mastered". Nothing throws. The client's untyped `SupabaseClient` means typecheck can't catch it. A fix needs a migration: a `SECURITY DEFINER` function, since RLS hides other users' rows, counting distinct users with the exact range and `hard.completed`.
- **A failed load looks like no verse.** `getCurrentVOTM` returns null on any error, so a network failure shows "No verse of the month yet."
- **Home doesn't refetch on focus.** After mastering the VOTM, the status stays "In Library" until pull to refresh. An app left open across a month boundary keeps the old verse the same way.
- **A broken image URL leaves unreadable text.** The card has no `onError` and no fallback. With `image_url` set it also drops its background color, so white text sits on the page background.
- **A slow text fetch holds up the whole card.** The skeleton waits for the text, so the card's own text spinner never shows on a normal load.

## Browser checks

The seed adds no `verse_of_month` row.

- `npm run sim -- shot /home --as reader-a`: the "No verse of the month yet." card, and an insights card with 5 day streak, 1 mastered, 1 in progress on a freshly reset database.
- `npm run sim -- shot /home --as reader-b`: the same empty VOTM card, and an insights card with 0 day streak, 0 mastered, 0 in progress.
- Add a local `verse_of_month` row for the current month, then `npm run sim -- shot /home --as reader-a`: the VOTM card with reference, text and "0 people have mastered" (the missing function).
- `npm run sim -- flow collection-discovery`: Home and Explore in both themes, introduction, KJV preview, add and open the saved copy.
- `npm run sim -- flow collection-icons`: save icons on an imported and a personal collection, cancel a pending change, and relaunch to verify both saves.
- `npm run sim -- flow collection-savers`: save with two seed accounts, compare all three count surfaces, and verify another translation and edits/delete/re-add do not add a second contribution.
- Against a freshly reset disposable local stack, run `tests/curated-collection.integration.ts` with local seed credentials for concurrent imports/lost responses, and `tests/curated-savers-migration.integration.ts` for the real migration's backfill. These checks use the local environment; the migration test rolls back all fixtures.
- By hand, with that row: tap the card and the expand modal opens. Close it, tap "Add to Library", and the collection picker opens.

## Decisions

- 2025-12-24 · VOTM stores a reference with no version · The challenge is the verse, and users read it in their own translation.
- 2026-01-20 · The count goes through an RPC · RLS stops a client counting other users' rows. The function it calls never reached a migration.
