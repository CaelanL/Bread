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
  gets this device's value written to it, which is how devices from
  before account translations carry their choice over. A value this app
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
   then moves every `user_verses` row, soft-deleted ones included, to the
   new version in one update.
3. Refetches verses and Mastered, so cards read the new text.

If step 2 fails the profile already holds the new translation. A toast says
to pull to refresh, and the next `hydrate()` or `refresh()` finishes the move,
since they run the same `alignVerses`. Progress, schedule, study prefs and
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
versions could create. `planCollapse` keeps the row with better progress:
mastered beats learning, then higher `passCount`, then more completed
difficulties. The winner takes the losers' collections and is restored if it
was soft-deleted. The losers are soft-deleted. A mastered loser stays in the
table, and `fetchMasteredVerses` lists one row per reference
(`onePerReference`), so it doesn't show twice. This runs on every hydrate,
refresh and switch, not only once, because old clients keep adding verses in
their device translation. Tests: `lib/store/__tests__/translation.test.ts`.

Adding a verse finds it by reference in any version (`addVerse`), so the add
flow can't create a second translation of a held verse. A soft-deleted match
comes back in the account translation.

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

Some translations omit certain verses (e.g. Mark 9:44 in the ESV and NIV).
A switch keeps such a held verse in its old version, see "Switching". The
server side:

- The adapter logs a warning if its parsed verse count doesn't
  match `getExpectedVerseCount` for that chapter.
- The DB cache treats the chapter as incomplete and re-fetches on
  every request — bad for the rate limit.
- There is no version-aware verse-count override.

This is a real limitation worth knowing about, especially for NIV
where some verses are footnoted out.

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

