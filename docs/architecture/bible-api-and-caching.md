# Bible API and Caching

A single endpoint — `GET /functions/v1/bible` — handles every Bible
text request that needs the network. It sits behind a 3-layer cache
(in-memory → Postgres → external API) so that within a session most
requests are millisecond-fast and across users the external APIs see
far fewer requests. KJV skips the endpoint, see "Bundled JSON — KJV".

For the *user's selected version* and how versions propagate, see
`docs/architecture/bible-versions.md`.

## The 3-layer cache

```
fetchVerse / fetchChapter   (lib/api/bible.ts)
        │
        ▼
┌──────────────────────────────────────┐
│  Layer 1: Session cache (in-memory)  │  cleared on app restart
│  lib/cache/session-cache.ts          │  no eviction, no TTL
└──────────────────────────────────────┘
        │ miss (KJV stops here: bundled JSON)
        ▼
GET /functions/v1/bible
   (auth → rate-limit → DB cache → adapter)
        │
        ▼
┌──────────────────────────────────────┐
│  Layer 2: Postgres verse_cache table │  500 rows per version, LRU
│  supabase/functions/bible/cache.ts   │  bumps last_used_at on read
└──────────────────────────────────────┘
        │ miss
        ▼
┌──────────────────────────────────────┐
│  Layer 3: External API               │  ESV → Crossway, others → API.Bible
│  supabase/functions/bible/adapters/  │
└──────────────────────────────────────┘
```

### Layer 1 — session cache

`lib/cache/session-cache.ts`. Four `Map`s, all in-memory, all
cleared on restart:

- `chapterCache`: `"John:3:ESV"` → `{ "1": text, "2": text, ... }`
- `verseCache`: `"John:3:16:ESV"` → `text`
- `savedVerseCache`: `"John:3:16-18:ESV"` → combined `text`
- `savedVerseKeyedCache`: `"John:3:16-18:ESV"` → `{ "16": text, ... }`

No eviction — relies on app restart. No TTL. The session cache is
why opening the same verse twice in a session never hits the network.

Two rules, both from the Psalm 103 bug (see Decisions):

- **`verseCache` entries are always single-verse text.** Range fetches
  cache each verse individually from the API's keyed data — never the
  combined range text under the start verse. Regression tests:
  `lib/__tests__/study-chunks.test.ts`.
- **`fetchVerse` results carry keyed `verses` on every path, including
  session-cache hits.** The hit path assembles the keyed map from
  `verseCache` per-verse. If a result ever lacks keyed data,
  `getVerseText` returns `verses: {}` (never a fabricated
  `{ start: wholeText }`), which routes `parseVerseIntoChunks` to its
  legacy sentence-split fallback. The fabricated shape put the entire
  passage in chunk 1 and left every other chunk empty.

### Layer 2 — Postgres `verse_cache`

`supabase/functions/bible/cache.ts` and the `verse_cache` table
(see `docs/architecture/data-model.md`).

- One row per `(book, chapter, verse, version)` — verse-level
  granularity. This is what makes overlapping ranges share storage
  (John 3:16-18 and John 3:17-20 share rows 17–18).
- LRU: `last_used_at` is bumped fire-and-forget on every read.
  When the per-version row count would exceed 500, oldest rows by
  `last_used_at` are evicted before insert (`evictOldestVerses`, which
  queries the table directly and doesn't use the SQL helpers).
- Completeness validation: a chapter is "fully cached" only when
  the row count for `(book, chapter, version)` reaches the expected
  count from `verse-counts.ts`. A partial chapter returns null and
  triggers a re-fetch. Ranges check for every verse in the range.
- The 500-per-version cap exists because of ESV/NLT licensing.

### Layer 3 — adapters

`supabase/functions/bible/adapters/`. Each adapter implements:

```ts
interface BibleAdapter {
  id: string;
  name: string;
  supportedVersions: string[];
  fetchVerse(ref, version): Promise<VerseResult>;
  fetchChapter(ref, version, expectedVerseCount): Promise<ChapterResult>;
}
```

The registry in `supabase/functions/bible/index.ts` maps versions to
adapters:

```ts
const adapters = {
  ESV: esvAdapter,            // Crossway API
  NLT: apiBibleAdapter,
  NIV: apiBibleAdapter,
  NKJV: apiBibleAdapter,
};
```

KJV is absent on purpose: the client serves it from the bundle, and a
KJV request to the function gets a 400.

**ESV adapter** (`adapters/esv.ts`): Crossway `api.esv.org`. Auth:
`Authorization: Token ${ESV_API_KEY}`. Plain-text response with
bracketed verse numbers — parsed with `/\[(\d+)\]\s*/g`.

**API.Bible adapter** (`adapters/apibible.ts`): `rest.api.bible`.
Auth: `api-key: ${API_BIBLE_KEY}`. Bible IDs hardcoded:

| Version | Bible ID |
|---|---|
| NLT | `d6e14a625393b4da-01` |
| NIV | `78a9f6124f344018-01` |
| NKJV | `63097d2a0a2f7db3-01` |

References are converted to USFM codes (e.g. `John 3:16` →
`JHN.3.16`, `1 Samuel 1:1` → `1SA.1.1`). Response is HTML with
verse markers, parsed with multiple fallback patterns
(`data-number`, `<sup>`, `[verse]`).

## End-to-end flows

### Single verse — `John 3:16`, ESV

```
fetchVerse("John 3:16", "ESV")
  → session verseCache has "John:3:16:ESV"
      HIT  → return { text, verses: { 16: text }, cached: true }
      MISS ↓
  GET /functions/v1/bible?ref=John%203%3A16&version=ESV
    getAuthUser(req)
    checkAndIncrementBibleUsage(userId)
    getCachedVerse(book, chapter, verse, version)
        HIT  → bump last_used_at, return with cached: true
        MISS ↓
    esvAdapter.fetchVerse("John 3:16", "ESV")
    cacheVerse(...) → evict if at the cap, upsert into verse_cache
    return { reference, version, text, verses: { 16: text }, cached: false }
  → session verseCache set per verse
```

### Verse range — `John 3:16-18`, ESV

```
fetchVerse("John 3:16-18", "ESV")
  → session verseCache has all of verses 16, 17, 18
      HIT  → assemble keyed map and combined text, cached: true
      MISS ↓
  GET /functions/v1/bible?ref=John%203%3A16-18&version=ESV
    getCachedVerseRange + getCachedVerseRangeKeyed
        HIT  → return all 3 verses
        MISS (any verse missing) ↓
    Strategy: fetch the FULL CHAPTER and extract the range
      esvAdapter.fetchChapter("John 3", "ESV", expectedCount=36)
      Extract verses 16–18 from the chapter result
      cacheChapter(...) → upsert only those 3 verses
    return { reference, version, text: combined, verses: {16,17,18}, cached: false }
  → session verseCache set per verse
```

The chapter fetch gives clean per-verse text. Only the requested
verses go into `verse_cache`, so a later request for another verse in
that chapter still calls the external API.

`getVerseText(savedVerse)`, the wrapper screens use, adds its own layer:
it checks `savedVerseCache` and `savedVerseKeyedCache` first, calls
`fetchVerse` on a miss, and stores both formats.

### Full chapter — `John 3`, ESV

```
fetchChapter("John", 3, "ESV")
  → session chapterCache has "John:3:ESV"
      HIT  → return verse map, cached: true
      MISS ↓
  GET /functions/v1/bible?ref=John%203&version=ESV&chapter=true
    expectedCount = getExpectedVerseCount("John 3")  // 36
    getCachedChapter(book, chapter, version, expectedCount)
        Returns null if row count < expectedCount (incomplete)
        HIT  → return all 36 verses
        MISS ↓
    esvAdapter.fetchChapter("John 3", "ESV", 36)
    cacheChapter(...) → LRU evict if total > 500, then upsert
    return { reference, version, verses: {1..36}, cached: false }
  → setChapterInSession also fills verseCache per verse
```

## Verse-count validation

`supabase/functions/bible/verse-counts.ts` exports a hardcoded
`VERSE_COUNTS` map: `book → number[]` (one entry per chapter).
`getExpectedVerseCount("John 3")` → `VERSE_COUNTS.John[2]` → `36`.

This is the single source of truth for "is this chapter complete?"
in the cache. Adapters log a warning if their parsed verse count
doesn't match the expected count, but they don't fail. If the count
is unknown (0), `getCachedChapter` skips the cache read, since it
can't validate completeness.

## Reference normalization

`supabase/functions/bible/normalize.ts` converts user-entered
references to canonical form *before* anything is cached or
compared. Examples:

- `"jn 3:16"` → `"John 3:16"`
- `"1 sam 1:1"` → `"1 Samuel 1:1"`
- `"Psalm 23"` → `"Psalms 23"` (use the JSON-keyed plural form)

**Always normalize before keying.** Otherwise the same verse can
get cached under multiple keys, blowing the LRU budget.

## Rate limiting

`checkAndIncrementBibleUsage(userId)` in
`supabase/functions/_shared/usage.ts` runs after the request is
validated and *before* the cache check. This means even cache hits
count against the quota — by design, so that a single user can't blow
through external API budget by re-requesting cached verses. Increment
happens in `usage_daily(user_id, date)`. On 429, the response includes
`used`, `limit` and a `resetsAt` of next midnight UTC. The tier limits
are in `docs/architecture/edge-functions.md`.

## Response shape

```ts
type BibleResponse = {
  reference: string;     // canonical form
  version: string;
  text?: string;          // single verse or combined for ranges
  verses?: { [verseNum: string]: string };  // keyed map for ranges/chapters
  cached: boolean;        // true on session-cache, DB-cache and KJV bundle hits
};
```

Single verses still include `verses: { [n]: text }` for
consistency. Ranges always provide both `text` (combined) and
`verses` (keyed). Chapters return `verses` only.

## Errors

| HTTP | Cause |
|---|---|
| 401 | Missing or invalid JWT |
| 400 | Invalid reference, unsupported version, missing params, method other than GET |
| 429 | Rate limit exceeded — response includes `resetsAt` |
| 500 | External API failure, DB error, parse failure |

The client (`lib/api/bible.ts`) turns these into thrown `Error`s. The
caller decides what to show.

## Bundled JSON — KJV

`assets/bible/kjv-1769.json` (~4.5 MB) is bundled with the app and
serves all KJV reads. It's a flat map (`"John 3:16"` → text). The
resolver (`lib/bible/kjv-bundle.ts`, `getKjvVerse` and `getKjvChapter`)
is called from inside `fetchVerse` / `fetchChapter` as a short-circuit
that runs after the session-cache check and before the network call.
This means:

- KJV reads never hit the edge function
- KJV reads never increment `usage_daily` / `bible_fetch_count`
- KJV reads never populate `verse_cache`
- KJV verse text works completely offline. Saving progress and
  submitting recordings still need the network.
- The session cache is still populated for KJV reads, so re-reading
  the same verse in a session is instant

A local lookup returns the same shape as the network path
(`BibleVerse` / `ChapterResponse`, keyed `verses` included), so callers
can't tell the difference. The resolver normalizes the book with
`normalizeBookName`, and it throws if a verse or chapter isn't in the
bundle, like any other failed fetch.

Licensed translations (ESV, NLT, and the others that go through the
network) are never bundled. Only public-domain text can be.

The JSON is `require()`'d lazily on first KJV read; the parsed
object is cached in module scope after that. Non-KJV users pay no
startup cost for the bundle.

Source data was preprocessed once (`scripts/clean-kjv.js`) to strip
italics-bracket artifacts (`[is]` → `is`), strip leading `#`
paragraph markers, and normalize the `Solomon's Song` book name to
`Song of Solomon`. It also checks every chapter's verse count against
`assets/bible/structure.json`. Re-run that script if the bundle is ever
replaced from upstream.

`lib/bible/index.ts` separately imports `assets/bible/structure.json`
(the canonical book/chapter list) for the Browse Bible UI; that's
unrelated to KJV serving.

## Invariants

**Invariant 2: verse text is NEVER stored in `user_verses`.** The
`text` column was dropped in migration 005 to comply with ESV/NLT
licensing. Verse text only lives in `verse_cache` (server, max 500 per
version, LRU evicted) and the in-memory session cache, plus the KJV
bundle, which is public domain. If you find yourself adding a `text`
field to a user-owned table, stop. The optional `text` and `verses` on
the `SavedVerse` type are filled in memory and never written.

**Invariant 3: all Bible verse reads go through `fetchVerse()` /
`fetchChapter()` in `lib/api/bible.ts`.** Never read JSON files
directly from components/screens, never call the edge function ad-hoc.
The session cache, rate limiting, and KJV bundle short-circuit only
work if you go through this layer. `lib/bible/kjv-bundle.ts` is read
**only** from inside `fetchVerse`/`fetchChapter` — not directly by any
caller. Don't add a parallel KJV-only read function.

Also:

- **Normalize the reference before caching or comparing on the server.**
  `normalizeReference` runs once at the top of the handler. Everything
  after it uses the result.
- **Adapter responses must be normalized to
  `{ verses: { [n]: text } }` before caching.** Single verses get
  wrapped as `{ [n]: text }`. Ranges keep the full keyed map.
- **Rate limit fires *before* the cache check.** Cache hits still
  count. Don't move the rate limit after the cache check to "save
  quota" — that defeats per-user fairness.
- **LRU eviction happens at insert time, not lazily.** Don't
  assume the DB cache can hold unbounded rows.
- **Verse-count validation is the only completeness signal.** Use
  `getExpectedVerseCount`; don't guess from response length.

## Sharp edges

- **Eviction looks broken when caching chapters and ranges.**
  `evictOldestVerses` is called with the book and chapter to exclude,
  and builds `query.not("and", "(book.eq...)")`. `not()` takes three
  arguments, so the filter comes out malformed and its result isn't
  checked. `cacheChapter` would then upsert without evicting, and a
  version could pass 500 rows. `cacheVerse` passes no exclusion, so
  single-verse caching isn't affected.
- A version with intentionally missing verses fails the completeness
  check and re-fetches every time. See
  `docs/architecture/bible-versions.md`.
- `fetchVerse` only short-circuits KJV when the reference has a verse.
  A chapter-only KJV reference to `fetchVerse` goes to the function and
  gets a 400. Use `fetchChapter`.
- The `bible_fetch_count` increment is in `usage_daily`, but
  there's no separate counter per *version* — a heavy NIV user
  competes for the same 100/day quota as their ESV use.
- Eviction is based on `last_used_at` per version, but the
  `bump-on-read` is fire-and-forget. Under load, two concurrent
  reads of the same verse may double-bump or race; harmless but
  not ordered.

## Decisions

- 2025-12-19 · `user_verses.text` dropped, text kept only in `verse_cache` and memory · ESV/NLT licensing limits stored text to 500 verses per version.
- 2026-04-27 · Serve KJV from a bundled JSON and remove it from the adapter map and `BIBLE_IDS` · It's public domain, works offline, and costs no API quota.
- 2026-08-15 · Session `verseCache` holds single-verse text only, and `fetchVerse` always returns keyed `verses` · Combined range text under the start verse put a whole passage in chunk 1 (Psalm 103).
