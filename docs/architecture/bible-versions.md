# Bible Versions

For the cache and adapter pipeline behind the scenes, see
`docs/architecture/bible-api-and-caching.md`.

## Currently supported versions

Five versions, defined in `lib/settings.ts`:

| Code | Name | Source |
|---|---|---|
| ESV | English Standard Version | Crossway API |
| NLT | New Living Translation | API.Bible |
| NIV | New International Version | API.Bible |
| NKJV | New King James Version | API.Bible |
| KJV | King James Version | Bundled JSON (1769 ed., public domain) — works offline |

Don't re-introduce CSB without re-adding the API.Bible ID and
re-checking licensing.

## Where the user's selection lives

The translation is an account setting: one per account, and every saved
verse shows and scores in it.

```
profiles.translation (one row per user, owner-only RLS)   ← source of truth
        │
        ├── Zustand store (lib/store/index.ts): bibleVersion (default "ESV")
        │
        └── AsyncStorage "app_bible_version": local cache, used when the
            profile can't be read (offline, before hydrate)
```

- `hydrate()` and `refresh()` run `syncAccountTranslation`: read the
  profile into the store and cache. An account with no translation yet
  gets the version most of its active verses use (`seedTranslation`), or
  this device's value if it has none, so the first device to sign in
  doesn't move every verse to its own choice. A value this app
  version doesn't know (a newer app's translation) is left alone.
- `useAppStore(s => s.bibleVersion)` reads it.
  `useAppStore.getState().setBibleVersion(version)` is the account switch,
  see "Switching".

Three pickers change it, all through `setBibleVersion`: Settings, and the
add-verse book and chapter screens (`add.tsx`, `add/[book]/[chapter].tsx`).
The add-screen picker shows "Changes your translation everywhere." the first
time it opens on a device (`accountNote` on `BibleTranslationPicker`, flag
`translation_account_note_seen`). The curated collection preview has its own
picker that changes only the preview, see `docs/features/home.md`.

## Switching

`setBibleVersion(version)` updates the store at once, then, one at a time
with any other translation work (`queueTranslationWork`):

1. Writes `profiles.translation`. On failure the picker goes back and an
   error toast shows.
2. Runs `alignVerses`: collapses two translations of one verse (below),
   then moves `user_verses` rows, soft-deleted ones included, to the new
   version. Only one row per reference moves (`planMoves`): the active one if
   there is one, else the best. If a soft-deleted twin already holds the new
   version, the two swap versions, so no reference ever has two rows in one
   version. Older app versions look a verse up by reference and version and
   expect at most one row.
3. Refetches verses and Mastered, so cards read the new text.

If step 2 fails the profile already holds the new translation. A toast says
to pull to refresh, and the next `hydrate()` or `refresh()` finishes the move,
since they run the same `alignVerses`. A failure there shows the same toast.
A pick made while a sync is running wins over the profile that sync read. Progress, schedule, study prefs and
`last_practiced_at` are columns of the same row, so they stay.

**Verses a translation leaves out.** ESV, NIV and NLT leave some verses out
of the main text (Mark 9:44, Acts 8:37 and others). A row whose range touches
one of those (`OMITTED_IN_SOME_TRANSLATIONS` in `lib/store/translation.ts`)
is read in the target through `fetchVerse` before it moves. If any verse
comes back empty, or the read fails, the row keeps its version and an alert
says which verses stayed. Each verse and translation is told once per device
(`translation_kept_notices`). Every other row moves without a Bible fetch.

**One verse per reference.** Two rows with the same book, chapter and range
in different versions are one verse held twice, which only older app
versions could create. `planCollapse` looks only at active rows and keeps the
one with better progress: mastered beats learning, then higher `passCount`,
then more completed difficulties. A soft-deleted row never wins, so a verse
the user reset or removed stays that way. The winner takes the losers'
collections, and the losers are deleted outright (allowed by the owner
DELETE policy on `user_verses`; a delete that removes fewer rows throws). `session_attempts` has no
foreign key to `user_verses`, so their history and stats stay.
`fetchMasteredVerses` still lists one row per reference
(`onePerReference`) for soft-deleted twins. This runs on every hydrate,
refresh and switch, not only once, because old clients keep adding verses in
their device translation. Tests: `lib/store/__tests__/translation.test.ts`.

Adding a verse finds it by reference in any version (`addVerse`), so the add
flow can't create a second translation of a held verse. A soft-deleted match
comes back in the account translation, unless another row of that reference
already holds it or the verse may be left out there; then it keeps its own.

## Propagation

The selected version flows through every network Bible read (KJV
stops at `fetchVerse` / `fetchChapter`, see "Bundled vs fetched"):

```
User selects "NIV" in Settings
  → setBibleVersion("NIV") → store + AsyncStorage
  → next call to fetchVerse(ref, version) uses "NIV"
  → session-cache key includes version: "John:3:16:NIV"
  → edge function: GET ?ref=...&version=NIV
  → adapter registry picks apiBibleAdapter (NIV's adapter)
  → API.Bible Bible ID for NIV is used
```

The version is part of the cache key everywhere — session cache,
DB `verse_cache`, and the per-row uniqueness in the cache table.
Switching versions does NOT invalidate the cache; it just reads
from a different keyspace.

## Where the version is referenced

If you add a new version, every one of these needs an entry:

| File | What to update |
|---|---|
| `lib/settings.ts` | `BibleVersion` type, `BIBLE_VERSIONS` array, display info (name) |
| `lib/api/bible.ts` | its own `BibleVersion` type |
| `lib/storage/index.ts` | its own `BibleVersion` type |
| `supabase/functions/bible/index.ts` | `adapters` registry — pick existing adapter or write a new one |
| `supabase/functions/bible/adapters/apibible.ts` | If using API.Bible: add Bible ID to `BIBLE_IDS` |
| `supabase/functions/bible/adapters/esv.ts` | Only if it's a new ESV-API-served version (unlikely) |
| Settings and add-verse UI | Render from `BIBLE_VERSIONS`, nothing to do |
| Discovery content | Verify distinct references in `lib/collections/catalog.ts` and `lib/votm/schedule.ts` through `fetchVerse`. `tests/verify-discovery-translations.ts` checks every keyed verse and logs references/status only, never Scripture text. Run from the isolated local verifier with matching `.env.local` and local seed credentials, outside CI. Provider secrets and test quota stay local; see `edge-functions.md`. |

If using a brand-new external API, write a new adapter implementing
the `BibleAdapter` contract (see
`docs/architecture/bible-api-and-caching.md`) and register it in the
`adapters` map.

## Per-user vs global

- **Per account**: `profiles.translation`, cached as `bibleVersion`.
- **Per verse saved by user**: `user_verses.version` stays a column, for
  old clients and because each row may lag the account during a switch or
  keep an older version when the account translation leaves the verse out.
  New clients write it from the account translation.
- **Per attempt**: `session_attempts.version` records the version practiced,
  so history keeps what was actually recited. Stats that count verses group
  by reference, not version (`update_user_stats`, `popular_ranges`).
- **Global VOTM**: `verse_of_month` has no version column. The
  client renders the VOTM in the user's *current* `bibleVersion`.
  Mastery checks for VOTM ignore version — see
  `docs/features/home.md`.

## Bundled vs fetched

KJV is bundled and served client-side. The other four versions (ESV,
NLT, NIV, NKJV) are licensed and go through the network path. Both are
in `docs/architecture/bible-api-and-caching.md`.

## Missing-verse handling

Modern translations (ESV, NIV, NLT, NKJV footnotes them) drop 16 verses
that the KJV numbers in the main text: Matthew 17:21, 18:11, 23:14; Mark
7:16, 9:44, 9:46, 11:26, 15:28; Luke 17:36, 23:17; John 5:4; Acts 8:37,
15:34, 24:7, 28:29; Romans 16:24. Longer passages that some translations
bracket (Mark 16:9-20, John 7:53-8:11) keep their verse numbers and text,
so they are not on the list.

`OMITTED_IN_SOME_TRANSLATIONS` in `lib/store/translation.ts` holds that
list (plus Matthew 12:47, which ESV and NIV do print; a false positive
costs one fetch and nothing else). `mayBeMissing()` decides which held
verses a switch reads in the target translation before moving them
(`isAvailableIn` in `lib/store/index.ts`): any empty verse in the range,
or a failed fetch, keeps the row in its old version and shows one alert
per verse and translation. The list is only a hint that limits fetches;
the fetch result is what decides.

Adding a translation: check it against this list, and for two other
shapes the fetch check catches but the UI doesn't explain:

- Merged verse numbers (NLT prints some pairs as "3-4" under one
  number). A single-verse fetch comes back empty, so the verse is kept
  in its old version with the generic alert.
- A verse missing in the new translation but not on the list. The switch
  moves it without reading it, and its card then shows empty text. Add
  the reference to the list.

Server side: the adapter logs a warning when its parsed verse count
doesn't match `getExpectedVerseCount`, the DB cache treats such a
chapter as incomplete and re-fetches it on every request (bad for the
rate limit), and there is no version-aware verse-count override.

## Browser checks

- `npm run sim -- flow account-translation`: the tap path, see `docs/features/library.md`.
- `npm run sim -- shot "/(tabs)/settings" --as reader-a`: the Translation row reads "Every saved verse uses it" and the account translation.

## Invariants

1. **Version is part of every cache key.** Don't strip it. Don't
   assume "ESV is the default and we can omit it."
2. **Verses follow the account translation.** `user_verses.version` is
   moved only by `alignVerses`. `session_attempts` keeps its own version
   column, so history isn't rewritten.
3. **VOTM mastery ignores version on purpose.** Mastering John 3:16
   in NLT counts the same as ESV. `hasUserMasteredVOTM` and
   `getVOTMMasteryCount` take no version.
4. **If you add a version, update every site listed above in the
   same PR.** Forgetting the adapter registry is a 400 on every read
   of that version.

## Decisions

- 2026-02-15 · CSB removed (commit `06ae8fe`) · The commit gives no reason, so re-check licensing before bringing it back.
- 2026-11-11 · Translation is an account setting in `profiles`, and every held verse follows it · Users memorize a verse, not a translation; two copies of one verse in two translations were confusing.
- 2026-11-11 · Collapse runs in the client on every sync, keeping the better row · Additive migrations only, and old clients keep creating pairs.
- 2026-11-11 · Only verses on the omitted list are read before moving · The free tier allows 100 Bible fetches a day; a switch shouldn't spend one per verse.
