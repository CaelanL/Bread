# Bible Versions

> **Status: Living document.** Update when a version is added or
> removed, or when the user's selection mechanism changes. Read
> before touching `lib/settings.ts`, the version selector in
> Settings, or the `version` parameter on any API call.

For the cache and adapter pipeline behind the scenes, see
`docs/architecture/bible-api-and-caching.md`.

## Currently supported versions

Five versions, defined in `lib/settings.ts`:

| Code | Name | Source |
|---|---|---|
| ESV | English Standard Version | Crossway API |
| KJV | King James Version | Bundled JSON (1769 ed., public domain) — works offline |
| NLT | New Living Translation | API.Bible |
| NIV | New International Version | API.Bible |
| NKJV | New King James Version | API.Bible |

> **Heads up:** the README lists only ESV/NLT/KJV. The code (and the
> Settings UI) supports all five. README is stale.

CSB was supported earlier and was removed in commit `06ae8fe`. Don't
re-introduce CSB without re-adding the API.Bible ID and re-checking
licensing.

## Where the user's selection lives

```
Zustand store (lib/store/index.ts)
  bibleVersion: BibleVersion (default: "ESV")
        │
        ├── persisted to AsyncStorage as "app_bible_version"
        │   (saved on every setBibleVersion call, hydrated at app start)
        │
        └── NOT synced to Supabase
            (so if the user signs in on a new device, they get ESV
             until they change it)
```

Selectors:

- `useAppStore(s => s.bibleVersion)` — read
- `useAppStore.getState().setBibleVersion(version)` — write

The version selector lives on the Settings tab.

## Propagation

The selected version flows through every Bible read:

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
| `lib/api/bible.ts` | `BibleVersion` type alias if separately defined |
| `supabase/functions/bible/index.ts` | `adapters` registry — pick existing adapter or write a new one |
| `supabase/functions/bible/adapters/apibible.ts` | If using API.Bible: add Bible ID to `BIBLE_IDS` |
| `supabase/functions/bible/adapters/esv.ts` | Only if it's a new ESV-API-served version (unlikely) |
| Settings UI | Likely auto-renders from `BIBLE_VERSIONS` — verify |

If using a brand-new external API, write a new adapter implementing
the `BibleAdapter` contract (see bible-api-and-caching.md) and
register it in the `adapters` map.

## Per-user vs global

- **Per user**: which version they currently see (`bibleVersion`
  in their Zustand store). Local-only — not synced.
- **Per verse saved by user**: each `user_verses` row has its own
  `version` column, set at save time. Switching the global setting
  doesn't change verses already saved — those keep their original
  version forever (relevant for streak / mastery progression).
- **Global VOTM**: `verse_of_month` has no version column. The
  client renders the VOTM in the user's *current* `bibleVersion`.
  Mastery counting for VOTM ignores version — see
  `docs/architecture/home-and-votm.md`.

## Bundled vs fetched

KJV is bundled (`assets/bible/kjv-1769.json`, ~4.5 MB) and served
client-side. KJV reads never hit the network, never increment the
rate limiter, never populate `verse_cache`. The integration is in
`fetchVerse` / `fetchChapter` (`lib/api/bible.ts`) — they
short-circuit to the local resolver in `lib/bible/kjv-bundle.ts`
when `version === "KJV"`.

The other four versions (ESV, NLT, NIV, NKJV) are licensed and go
through the network path. See `bible-api-and-caching.md`.

The bundled file went through one-time preprocessing
(`scripts/clean-kjv.js`) to:
- Strip italicized-supplied-word brackets (`[is]` → `is`, keeping
  the words since they're required for English grammar)
- Strip leading `#` paragraph markers
- Rename keys from `Solomon's Song` to `Song of Solomon` to match
  the canonical name used everywhere else in the codebase

## Missing-verse handling

Some translations omit certain verses (e.g. Mark 16:9–20 in some
modern editions). Current behavior:

- The adapter logs a warning if its parsed verse count doesn't
  match `getExpectedVerseCount` for that chapter.
- The DB cache treats the chapter as incomplete and re-fetches on
  every request — bad for the rate limit.
- There is no version-aware verse-count override.

This is a real limitation worth knowing about, especially for NIV
where some verses are footnoted out. Listed in
`docs/architecture/bible-api-and-caching.md` sharp edges.

## Invariants

1. **Version is part of every cache key.** Don't strip it. Don't
   assume "ESV is the default and we can omit it."
2. **The version a verse was saved at is locked in
   (`user_verses.version`).** Don't migrate it across versions
   based on the user's current selection — that would invalidate
   `session_attempts` history for that verse.
3. **`get_votm_mastery_count` ignores version on purpose.** Mastering
   John 3:16 in NLT counts the same as ESV.
4. **If you add a version, update every site listed above in the
   same PR.** Forgetting the adapter registry is a 500 in
   production.
