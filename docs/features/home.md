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

## Monthly schedule and loading

`lib/votm/schedule.ts` defines thirty-six distinct one- or two-verse passages and
120 month assignments from November 2026 through October 2036. The generated seed
migration inserts missing months only. Existing selections and `image_url` values
survive; they may differ from the generated three-year rotation. Schedule tests
check canonical bounds, continuous coverage and SQL/source parity.

`useVotm` loads on Home focus, translation change, app return and pull to refresh.
While focused, a short local clock check detects a month change without a long
JavaScript timer or server polling. `getCurrentVOTM` uses the device's local month.
Existing book aliases such as Psalm retain their display reference and normalize
through the shared Bible helper for fetching.

The reference appears as soon as metadata arrives. Text and mastery reads run in
parallel through the existing Bible/API paths. `createMonthlyLoader` clears old
text immediately and ignores responses from an older month, version, account or
blurred screen. A missing schedule row shows the empty card; a failed metadata
read offers Try again. A text failure keeps the reference and offers a text retry.
Only the current month's text is fetched, not the future schedule.

## `verse_of_month`

Defined in `supabase/migrations/007_verse_of_month.sql`, with `image_url` added in `008_votm_image.sql`.

- `year_month` is unique text like `2026-11`.
- A row holds a reference: book, chapter, verse start and end. There is no version column.
- Anyone can read it, signed in or not. No write policy exists, so rows are added with the service role.

`image_url` is free-form text. The bucket line in migration 008 is a comment, so no migration creates a storage bucket.

## The card

- **Text.** Three lines at most, in the user's `bibleVersion`, with the version shown beside the reference.
- **Art.** `expo-image` fills the whole card behind native white copy and the original dark overlay. The compact reference badge, header, three-line body and footer retain the original card structure. A broken image returns to the plain themed card with contrasting text; collection symbols are not monthly artwork.
- **Count.** "N people have mastered" appears only after a successful `getVOTMMasteryCount` response. A successful zero is shown; an unknown/unavailable count is omitted.
- **User status.** One of these, in this order:

| Condition | Shows |
|---|---|
| `hasUserMasteredVOTM` is true: a row of theirs with the same range and `hard.completed`, in any version, soft-deleted included | "Mastered" |
| The same range is in `verses`, in any version | "In Library" |
| Otherwise | "Add to Library" button |

**Tapping.** The card opens `VerseExpandModal`. It does not start a session. "Add to Library" on the card, or the add button in the modal, opens `AddToCollectionModal`.

## Encouragement video

Home's provisional Why memorize Scripture entry opens the credited official source when
`INTRO_VIDEO.playback` is unset. Activating in-app playback requires a rights-cleared
asset and matching timed captions in `lib/intro/media.ts`; the stable intro ID does
not change for a new cut, title or soundtrack. No third-party sermon is bundled.

`user_intro_presentations` uses `(user_id, intro_id)` as its key, a claim timestamp,
and an account FK with ON DELETE CASCADE. Owner-only SELECT/INSERT policies and
grants deny anonymous access and client UPDATE/DELETE. `claim_intro_presentation`
is an authenticated invoker with an empty search path; insert-on-conflict returns
true only for the winning insert.

`createIntroCoordinator` reads the account's presentation state, prepares media in
a paused hidden native Video, configures audio, then atomically claims immediately
before presenting. Reads and claims snapshot the initiating session's token for each attempt. Same-account token refreshes do not replace the coordinator or close playback. Only a
confirmed winning claim can autoplay; local absence, offline state, failed reads,
failed preparation and lost claim acknowledgements never authorize presentation.
A committed claim may consume the opportunity before a visible frame if focus is
lost or playback later fails. Manual replay remains available and does not reset
account eligibility. No writes are queued offline.

The coordinator requires focused/active Home, completed hydration, settled reminder
UX and no verse/collection modal. Home retains opened verse/picker content through
metadata refresh and blocks intro until native dismissal. Q1's transient native
presentation flag blocks an
overlap through its actual dismissal; a stale reminder check rechecks dismissal
before opening. Transient inactivity pauses playback in place and resumes only if it was playing; it blocks new automatic starts. Backgrounding, navigation, account changes and close unload the players. Audio starts with `playsInSilentModeIOS: false`, recording disabled and no
background playback. Cleanup does not restore a guessed recording audio mode.

`IntroVideoModal` exposes Close immediately, timed captions, pause and replay. Actual
sound-on, silent-switch, background/closed silence and recording afterward must be
checked on a physical iPhone; simulator playback alone cannot establish them.

Local builds (`__DEV__` plus loopback/private-LAN Supabase) expose **Test video
player** on Home. The labeled original nine-second tone/video uses manual replay,
even after a claim. A tap waits for the fixture/preloader to mount and never reads
or consumes intro eligibility. The official link stays separate. Route fixture
changes clear the manual override; close preserves replay. Hosted/production
builds have no test button.

For local development only, `/home?introFixture=sample` uses the same fixture; `introFixture=unavailable` exercises a failed source. Both need
`__DEV__` and a loopback/private-LAN Supabase URL. This guard does not loosen dev
sign-in. Ordinary startup has no fixture. Metro includes the original 79 KB fixture asset in the production bundle, but the production guard never selects it; avoiding custom bundler configuration is the accepted size tradeoff. The server marker is shared by all devices
for the same local account, so reset the disposable test stack before a fresh intro
flow rather than deleting markers through the client.

## Rules

1. **VOTM is keyed by `year_month` from the local clock.** Don't switch to UTC without working through the rollover hour.
2. **VOTM has no version.** The reference is global, and the translation follows the user's setting.
3. **Mastery checks ignore version.** Everyone is working on the same verse, so any function behind the count must not filter by version.
4. **`verse_of_month` is admin-write only.** No client should insert.

## Sharp edges

- **`get_votm_mastery_count` doesn't exist in the repo. This is a bug.** `getVOTMMasteryCount` calls it with `p_book`, `p_chapter`, `p_verse_start` and `p_verse_end`, but no file in `supabase/` defines it, including `supabase/migrations/` and `supabase/database.types.ts`. On a database built from the migrations the call is unavailable, so `getVOTMMasteryCount` returns null and the card hides the optional count without an error banner. The client's untyped `SupabaseClient` means typecheck can't catch it. A fix needs a migration: a `SECURITY DEFINER` function, since RLS hides other users' rows, counting distinct users with the exact range and `hard.completed`.

## Browser checks

The release migration seeds the monthly schedule; the local seed preserves it.

- `npm run sim -- shot /home --as reader-a`: the current monthly card, and an insights card with 5 day streak, 1 mastered, 1 in progress on a freshly reset database.
- `npm run sim -- shot /home --as reader-b`: the same current monthly card, and an insights card with 0 day streak, 0 mastered, 0 in progress.
- `npm run sim -- shot /home --as reader-a`: the VOTM card with reference/text and no optional mastery total (the missing function).
- `npm run sim -- flow collection-discovery`: Home and Explore in both themes, introduction, KJV preview, add and open the saved copy.
- `npm run sim -- flow collection-icons`: save icons on an imported and a personal collection, cancel a pending change, and relaunch to verify both saves.
- `npm run sim -- flow collection-savers`: save with two seed accounts, compare all three count surfaces, and verify another translation and edits/delete/re-add do not add a second contribution.
- Against a freshly reset disposable local stack, run `tests/curated-collection.integration.ts` with local seed credentials for concurrent imports/lost responses, and `tests/curated-savers-migration.integration.ts` for the real migration's backfill. These checks use the local environment; the migration test rolls back all fixtures.
- `npm run sim -- flow monthly-verse`: original full-card artwork/overlay, readable native copy, image-error fallback, expand and add picker in both themes. Compare with the original card using the same actual artwork and reference; a placeholder cannot verify continuity.
- `npm run sim -- flow intro-test-player-appearance`: Home entry/player in both themes and same-session unavailable link. No claim precondition; restores Light.
- `npm run sim -- flow intro-test-player`: Home first tap/replay, no manual-test claim, then replay after a claim. Needs fresh verifier markers.
- `npm run sim -- flow intro-video`: local fixture autoplay, captions/progress, immediate close, no second automatic presentation, replay and unavailable/unset media.
- On a separate fresh disposable stack, `npm run sim -- flow intro-modal-handoff` defers intro while each existing Home modal is visible and presents after native dismissal. It consumes both accounts' markers; reset before the other intro flows.
- After `intro-video` has claimed reader-b's fixture, `npm run sim -- flow intro-interruption` checks native Control Center interruption, preserved pause/position, and background close. Physical iPhone verification is still required.
- `npm run sim -- flow intro-after-reminders`: fresh UI sign-in, no intro claim while the reminder is visible, then autoplay after native reminder dismissal. Run before that account has claimed the fixture.
- By hand: tap the card and the expand modal opens. Close it, tap "Add to Library", and the collection picker opens.

## Decisions

- 2025-12-24 · VOTM stores a reference with no version · The challenge is the verse, and users read it in their own translation.
- 2026-01-20 · The count goes through an RPC · RLS stops a client counting other users' rows. The function it calls never reached a migration.

- 2026-11-10 · Monthly choices use a thirty-six-passage cycle and fill only missing months · Existing editorial selections and artwork remain authoritative.
- 2026-11-10 · An account-wide atomic claim controls automatic intro presentation · Prefer suppressing an ambiguous attempt over surprising users twice; explicit replay remains available.
