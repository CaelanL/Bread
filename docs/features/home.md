# Home and Verse of the Month

Home, the first tab, shows the Verse of the Month (VOTM), a global monthly challenge; `InsightsCard`, a shortcut to Insights; and an Explore collections preview.

| File | Purpose |
|---|---|
| `app/(tabs)/(home)/home.tsx` | Loads VOTM data and composes the screen |
| `components/home/VOTMCard.tsx` | The VOTM card |
| `components/home/ExploreCollections.tsx` | Two curated collections and a See all link to `/explore` |
| `components/home/InsightsCard.tsx` | Streak, mastered and in-progress counts. Tap opens `/insights` |
| `lib/api/votm.ts` | `getCurrentVOTM`, `getVOTMMasteryCount`, `hasUserMasteredVOTM` |

What those numbers mean is in `docs/features/insights.md`.

## Explore collections

Under the Explore heading, two suggested collections are flat rows (art thumbnail, title,
subtitle, passages, saves) split by a hairline; the streak row above sits between hairlines
too. See all opens the full catalog. Rows use bundled artwork and passage counts, so
browsing fetches no Bible text.

An introduction lists tappable references; text expands on tap, in the system font. It
preloads the first two passages through `fetchVerse`, then the expanded one and its next
neighbor, one at a time, sharing pending and successful reads in memory per translation. A
version change or unmount stops preloading and ignores stale previews; failed reads stay
retryable. Its top-right `BibleTranslationPicker` (shared with verse selection, listing
`BIBLE_VERSIONS`) starts from the account translation and changes only the preview; when
it differs, a line under the action says verses are added in the account one. Before writing, the store
reads every passage at once in the account translation (`validateCollectionPassages`); an
incomplete read lets the user retry. The centered Add collection action
has intrinsic width and a 44-point minimum target.

`importCuratedCollection` saves every passage in the account translation in
one transaction and reads back the resulting collection. Matching references
in that translation share progress and study preferences. The copy's id
carries the translation it was saved in, but the introduction opens a saved
copy under any translation. Explicitly adding a deleted
copy restores its passages and eligible progress at the end of the
Library. A failed readback after saving offers Refresh Library.

The import migration adds a nullable icon key and allows Bread's translation
codes. Custom icons sync with the account; missing and unknown ones render the
Bible symbol; built-in ones are fixed.

### Community saves

Home, Explore and introductions show all-time unique accounts that saved each
curated collection, as "12 saves" (`saverCountLabel`), hidden below `MIN_SHOWN_SAVES` (10)
since small numbers read as empty. An account's first successful import counts once across
translations; editing, emptying, renaming, deleting or re-adding the copy doesn't change it.
It isn't a count of current copies or completed passages.

`curated_collection_savers` stores only a surrogate ID, catalog ID and nullable
user ID. Account deletion sets that user link to NULL; totals use `COUNT(*)`, so the
anonymous contribution stays. Clients cannot
read or write ledger rows. The import transaction calls a private, owner-checking
writer; `get_curated_collection_saver_counts` exposes bounded aggregate reads only.
The migration backfills exact known import identities, including soft-deleted
copies, deduplicated across versions; ordinary collections with similar names do
not count.

`curatedSaverCounts` in the store shares successful reads across these screens. Focus, a
[resume](../architecture/sync-and-storage.md#when-sync-happens) and pull to refresh fetch
totals; a committed import refreshes them, non-blocking, before Library readback. An unknown
number is omitted, a failed refresh keeps the last good total, and nothing is incremented
optimistically. Requests are account-scoped, ignore older reads, abort when their screen
loses focus, and never block browsing or saving.

When adding a catalog entry, update `private.curated_catalog_ids` through an additive
migration alongside the client catalog (`curated-savers-catalog.test.mjs` checks
parity). A new translation uses the same catalog contribution and needs no count ID.

## Monthly schedule and loading

`lib/votm/schedule.ts` defines thirty-six distinct one- or two-verse passages and
120 month assignments from November 2026 through October 2036. The generated seed
migration inserts missing months only, so existing selections and `image_url` values
survive and may differ from the three-year rotation. Schedule tests
check canonical bounds, continuous coverage and SQL/source parity.

`useVotm` and the streak (`useStreak`) reload through `useHomeReload` on focus and on a
resume only when `homeStale`
(`lib/resume.ts`) says so: no good load yet; another account, translation or month; a
session saved since (the store's `lastSessionAt`); or `HOME_STALE_MS` (5 min) passed. Pull
to refresh always reloads. While focused, a once-a-minute clock check catches a month change.
Aliases such as Psalm keep their display reference and normalize through the
Bible helper.

`createMonthlyLoader` starts the text and mastery reads of this month's `MONTHLY_SCHEDULE`
passage alongside the `verse_of_month` row, and reads again only if the row names another
passage. The reference shows when the row arrives. A reload of the month and translation on
screen keeps the card until new reads land (no skeleton, no art remount). Otherwise it
clears old text at once; it ignores responses from an older month, version, account or
blurred screen. No schedule row: the empty card; failed metadata: Try again; failed
text: reference and retry. Only the current month's text is fetched.

## `verse_of_month`

`supabase/migrations/007_verse_of_month.sql`; `image_url` from `008_votm_image.sql`.

- `year_month` is unique text like `2026-11`.
- A row holds a reference: book, chapter, verse start and end. There is no version column.
- Anyone can read it, signed in or not. No write policy exists, so rows are added with the service role.

`image_url` is free-form text. No migration creates the `images` bucket; only prod has it. `20261111144002_monthly_artwork.sql` makes it public and gives each artless month from 2026-11 to 2036-10 a plain URL: `vtm-gold-trees.png` in odd months, `vtm-dark-sky.png` in even ones.

## The card

- **Text.** Three lines at most, in the user's `bibleVersion`, with the version shown beside the reference.
- **Art.** `expo-image` fills the card behind white copy and the original dark overlay, in the original structure (reference badge, header, three-line body, footer). A broken image falls back to the plain themed card; collection symbols are never monthly artwork.
- **Count.** "N people have mastered" shows only after a successful `getVOTMMasteryCount`, zero included; an unknown count is omitted.
- **User status.** One of these, in this order:

| Condition | Shows |
|---|---|
| `hasUserMasteredVOTM` is true: a row of theirs with the same range and `hard.completed`, in any version, soft-deleted included | "Mastered" |
| The same range is in `verses`, in any version | "In Library" |
| Otherwise | "Add to Library" button |

**Tapping.** The card opens `VerseExpandModal`, not a session. "Add to Library" on the card, or the add button in the modal, opens `AddToCollectionModal`.

## Encouragement video

Home has no visible video entry. `components/home/IntroVideo.tsx` mounts only the
automatic player, which ships dormant: with `INTRO_VIDEO.playback` unset the
coordinator returns before any server read, preload or claim. In-app playback needs a
rights-cleared asset and matching timed captions in `lib/intro/media.ts`; the intro ID
stays stable across a new cut, title or soundtrack. No third-party sermon is bundled.
When a cleared clip or an official embed exists, restore the Home card (title, credit,
Watch button calling the coordinator's `replay`) from this file's git history.

`user_intro_presentations` is keyed by `(user_id, intro_id)`, with a claim timestamp
and an ON DELETE CASCADE account FK. Owner-only SELECT/INSERT policies and
grants deny anonymous access and client UPDATE/DELETE. `claim_intro_presentation`
is an authenticated invoker with an empty search path; insert-on-conflict returns
true only to the winner.

`createIntroCoordinator` reads the account's presentation state, prepares media in
a paused hidden native Video, configures audio, then claims atomically just
before presenting. Native unload/load has a 15-second deadline; cancellation and stale guards stop
late presentation or cleanup of a newer request. Each attempt's reads and claims use its session's token; same-account refreshes keep the coordinator and playback. Only a
confirmed winning claim autoplays; local absence, offline, failed reads or preparation
and lost claim acknowledgements never do. A committed claim may consume the chance
before a visible frame if focus is lost or playback fails. `replay` skips eligibility but
has no caller until the Home card returns. No writes are queued offline.

The coordinator needs focused, active Home, hydration done, reminder UX settled and no
verse or collection modal. Home keeps an open verse or picker through a
metadata refresh and holds the intro until its native dismissal. Q1's transient presentation
flag blocks overlap until actual dismissal; a stale reminder check rechecks. Transient inactivity pauses in place, resumes only if it was playing, and blocks new automatic starts. Backgrounding, navigation, account changes and close unload the players. Audio sets `playsInSilentModeIOS: true` (sound with the silent switch on), no recording or
background playback; the recorder sets its own mode on start, so cleanup restores none.

`IntroVideoModal` shows Close at once and timed captions. Tapping the video toggles pause
with a fading glyph. Below it: a play/replay button, elapsed/total time and a 44-point scrub
bar; a drag seeks exactly on release and keeps the play state (`lib/intro/scrub.ts`). Sound,
silent switch, background/closed silence and recording afterward need a physical iPhone.

In local builds (`__DEV__` plus loopback/private-LAN Supabase), `/home?introFixture=sample`
supplies a labeled original nine-second tone/video for the automatic path;
`introFixture=unavailable` uses a missing local file. Hosted/production builds ignore
the parameter; dev sign-in restrictions stay intact. The preloader is keyed by account
(per-fixture remounts failed their first unload). Ordinary startup has no fixture; release bundles carry the unused 79 KB fixture rather than custom bundler config. The server marker is per account, not device:
reset the stack before a fresh intro flow, never delete markers through the client.

## Rules

1. **VOTM is keyed by `year_month` from the local clock.** Don't switch to UTC without working through the rollover hour.
2. **VOTM has no version.** The reference is global, and the translation follows the user's setting.
3. **Mastery checks ignore version.** Everyone works on the same verse; nothing behind the count filters by version.
4. **`verse_of_month` is admin-write only.** No client should insert.

## Sharp edges

- **`get_votm_mastery_count` doesn't exist in the repo. This is a bug.** `getVOTMMasteryCount` calls it (book, chapter, verse start and end), but nothing in `supabase/` defines it, so it returns null and the card hides the count without an error; the untyped `SupabaseClient` hides it from typecheck. A fix needs a migration: a `SECURITY DEFINER` function, since RLS hides other users' rows, counting distinct users with the exact range and `hard.completed`.

## Browser checks

The release migration seeds the monthly schedule; the local seed preserves it.

- `npm run sim -- shot /home --as reader-a`: on a freshly reset database, the current monthly card with reference and text and no mastery total (the missing function), and an insights card with 5 day streak, 1 mastered, 1 in progress.
- `npm run sim -- shot /home --as reader-b`: the same current monthly card, an insights card with 0 day streak, 0 mastered, 0 in progress, Explore collections, and no video card.
- `npm run sim -- flow collection-discovery`: sets reader-b's account translation to KJV, then Home and Explore in both themes, introduction, KJV preview, add and open the saved copy, and an ESV preview that still opens it.
- `npm run sim -- flow collection-icons`: icons on an imported and a personal collection, a cancelled change, and both saves after a relaunch.
- `npm run sim -- flow collection-savers`: save with two seed accounts; all three surfaces hide the line (local counts stay under 10; DB and integration tests cover counting); another translation and edits/delete/re-add add no second contribution.
- On a freshly reset local stack, run `tests/curated-collection.integration.ts` (seed credentials; concurrent imports, lost responses) and `tests/curated-savers-migration.integration.ts` (the migration's backfill; rolls back its fixtures).
- `npm run sim -- flow monthly-verse`: original full-card artwork/overlay, readable native copy, image-error fallback, expand and add picker in both themes, compared with the original card (same artwork and reference).
- Each intro flow needs unclaimed accounts: run it on a freshly reset stack.
- `npm run sim -- flow intro-video`: local fixture autoplay, captions/progress, pause/resume, tap pause, scrub back, close, no second autoplay, and no presentation or claim for unavailable/unset media.
- `npm run sim -- flow intro-modal-handoff` defers intro while each Home modal is visible and presents after native dismissal, for both accounts.
- `npm run sim -- flow intro-interruption`: reader-b autoplay, a Control Center interruption keeping pause and position, background close; also on a physical iPhone.
- `npm run sim -- flow intro-after-reminders`: fresh UI sign-in, no intro claim while the reminder is visible, then autoplay after its native dismissal.
- By hand: tap the card for the expand modal; close it, tap "Add to Library" for the collection picker.

## Decisions

- 2025-12-24 · VOTM stores a reference with no version · The challenge is the verse, and users read it in their own translation.
- 2026-01-20 · The count goes through an RPC · RLS stops a client counting other users' rows.
- 2026-11-10 · Monthly choices use a thirty-six-passage cycle and fill only missing months · Existing editorial selections and artwork remain authoritative.
- 2026-11-10 · An account-wide atomic claim controls automatic intro presentation · Prefer suppressing an ambiguous attempt over surprising users twice. The replay surface left with the Home card and returns with it.
- 2026-11-11 · Monthly art is plain public URLs · Signed URLs expire.
- 2026-11-11 · Intro sound ignores the silent switch; scrubbing uses RN responders · A chosen video should just play; no new native module.
- 2026-11-11 · The curated preview picker previews only; imports use the account translation · One translation per account (`docs/architecture/bible-versions.md`).
- 2026-11-14 · Home's monthly verse and streak reload only when stale, after a session or in a new month (Q27) · Every focus reread both.
