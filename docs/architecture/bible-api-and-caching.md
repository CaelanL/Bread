# Bible API and Caching

> **Status: Living document.** Update when the cache layers change,
> a new adapter is added, or rate-limit logic moves. Read before
> touching `lib/api/bible.ts`, `lib/cache/`, or anything in
> `supabase/functions/bible/`.

A single endpoint — `GET /functions/v1/bible` — handles every Bible
text request. It sits behind a 3-tier cache (in-memory → Postgres →
external API) so that within a session most requests are
millisecond-fast and across users the external APIs see roughly one
request per (verse, version) pair.

For the *user's selected version* and how versions propagate, see
`docs/architecture/bible-versions.md`.

## The 3-tier cache

```
fetchVerse / fetchChapter   (lib/api/bible.ts)
        │
        ▼
┌──────────────────────────────────────┐
│  Tier 1: Session cache (in-memory)   │  cleared on app restart
│  lib/cache/session-cache.ts          │  no eviction, no TTL
└──────────────────────────────────────┘
        │ miss
        ▼
GET /functions/v1/bible
   (auth → rate-limit → DB cache → adapter)
        │
        ▼
┌──────────────────────────────────────┐
│  Tier 2: Postgres verse_cache table  │  500 rows per version, LRU
│  supabase/functions/bible/cache.ts   │  bumps last_used_at on read
└──────────────────────────────────────┘
        │ miss
        ▼
┌──────────────────────────────────────┐
│  Tier 3: External API                │  ESV → Crossway, others → API.Bible
│  supabase/functions/bible/adapters/  │
└──────────────────────────────────────┘
```

### Tier 1 — session cache

`lib/cache/session-cache.ts`. Four `Map`s, all in-memory, all
cleared on restart:

- `chapterCache`: `"John:3:ESV"` → `{ "1": text, "2": text, ... }`
- `verseCache`: `"John:3:16:ESV"` → `text`
- `savedVerseCache`: `"John:3:16-18:ESV"` → combined `text`
- `savedVerseKeyedCache`: `"John:3:16-18:ESV"` → `{ "16": text, ... }`

No eviction — relies on app restart. No TTL. The session cache is
why opening the same verse twice in a session never hits the network.

Two invariants, both learned from a real bug (Psalm 103, 2026-08):

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

### Tier 2 — Postgres `verse_cache`

`supabase/functions/bible/cache.ts` and the `verse_cache` table
(see `docs/architecture/data-model.md`).

- One row per `(book, chapter, verse, version)` — verse-level
  granularity. This is what makes overlapping ranges share storage
  (John 3:16-18 and John 3:17-20 share rows 17–18).
- LRU: `last_used_at` is bumped fire-and-forget on every read.
  When the per-version row count would exceed 500, oldest rows by
  `last_used_at` are evicted before insert (`evict_lru_verses`).
- Completeness validation: a chapter is "fully cached" only when
  the row count for `(book, chapter, version)` matches the expected
  count from `verse-counts.ts`. A partial chapter returns null and
  triggers a re-fetch.
- The 500-per-version cap exists because of ESV/NLT licensing.

### Tier 3 — adapters

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
  KJV: apiBibleAdapter,
  NLT: apiBibleAdapter,
  NIV: apiBibleAdapter,
  NKJV: apiBibleAdapter,
};
```

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
| KJV | `a6aee10bb058511c-02` |

References are converted to USFM codes (e.g. `John 3:16` →
`JHN.3.16`, `1 Samuel 1:1` → `1SA.1.1`). Response is HTML with
verse markers, parsed with multiple fallback patterns
(`data-number`, `<sup>`, `[verse]`).

## End-to-end flows

### Single verse — `John 3:16`, ESV

```
fetchVerse("John 3:16", "ESV")
  → session.verseCache.get("John:3:16:ESV")
      HIT  → return immediately, marked cached:true
      MISS ↓
  GET /functions/v1/bible?ref=John%203%3A16&version=ESV
    verifyJwt(req)
    checkAndIncrementBibleUsage(userId)   // free: 100/day, supporter: 10k/day
    cache.getCachedVerse(book, chapter, verse, version)
        HIT  → bump last_used_at, return
        MISS ↓
    esvAdapter.fetchVerse("John 3:16", "ESV")
    cache.cacheVerse(...) → upsert into verse_cache
    return { reference, version, text, verses: { 16: text }, cached: false }
  → session.verseCache.set("John:3:16:ESV", text)
```

### Verse range — `John 3:16-18`, ESV

```
fetchVerse("John 3:16-18", "ESV")
  → session.savedVerseKeyedCache.get("John:3:16-18:ESV")
      HIT  → return verse map
      MISS ↓
  GET /functions/v1/bible?ref=John%203%3A16-18&version=ESV
    cache.getCachedVerseRange(book, chapter, 16, 18, version)
        HIT  → return all 3 verses
        MISS (any verse missing) ↓
    Strategy: fetch the FULL CHAPTER and extract the range
      esvAdapter.fetchChapter("John 3", "ESV", expectedCount=51)
      cache.cacheChapter(...) → upsert all 51 verses (LRU evict if needed)
      Extract verses 16–18 from the chapter result
    return { reference, version, text: combined, verses: {16,17,18}, cached: false }
  → session.savedVerseKeyedCache.set(...)
```

This "fetch chapter to satisfy a range" strategy is intentional —
one external API call hydrates the whole chapter, so future requests
for any verse in that chapter hit the DB cache.

### Full chapter — `John 3`, ESV

```
fetchChapter("John", 3, "ESV")
  → session.chapterCache.get("John:3:ESV")
      HIT  → return verse map
      MISS ↓
  GET /functions/v1/bible?ref=John%203&version=ESV&chapter=true
    expectedCount = getExpectedVerseCount("John 3")  // 51
    cache.getCachedChapter(book, chapter, version, expectedCount)
        Returns null if row count < expectedCount (incomplete)
        HIT  → return all 51 verses
        MISS ↓
    esvAdapter.fetchChapter("John 3", "ESV", 51)
    cache.cacheChapter(...) → upsert + LRU evict if total > 500
    return { reference, version, verses: {1..51}, cached: false }
```

## Verse-count validation

`supabase/functions/bible/verse-counts.ts` exports a hardcoded
`VERSE_COUNTS` map: `book → number[]` (one entry per chapter).
`getExpectedVerseCount("John 3")` → `VERSE_COUNTS.John[2]` → `51`.

This is the single source of truth for "is this chapter complete?"
in the cache. Adapters log a warning if their parsed verse count
doesn't match the expected count, but they don't fail. If
`expectedCount` returns 0 (unknown book), the cache is bypassed
(treated as never-cacheable) to avoid false negatives.

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

`supabase/functions/_shared/usage.ts`. Two tiers (from the
`subscriptions` table):

| Tier | `bible_fetch_count` per day |
|---|---|
| Free | 100 |
| Supporter | 10,000 |

`checkAndIncrementBibleUsage(userId)` runs *before* the cache
check. This means even cache hits count against the quota — by
design, so that a single user can't blow through external API
budget by re-requesting cached verses. Increment happens in
`usage_daily(user_id, date)`. On 429, the response includes a
`resetsAt` of next midnight UTC.

## Response shape

```ts
type BibleResponse = {
  reference: string;     // canonical form
  version: string;
  text?: string;          // single verse or combined for ranges
  verses?: { [verseNum: string]: string };  // keyed map for ranges/chapters
  cached: boolean;        // false on this request, true on session-cache hits
};
```

Single verses still include `verses: { [n]: text }` for
consistency. Ranges always provide both `text` (combined) and
`verses` (keyed). Chapters return `verses` only.

## Errors

| HTTP | Cause |
|---|---|
| 401 | Missing or invalid JWT |
| 400 | Invalid reference, unsupported version, missing params |
| 429 | Rate limit exceeded — response includes `resetsAt` |
| 500 | External API failure, DB error, parse failure |

The client (`lib/api/bible.ts`) maps these to user-facing toasts via
`lib/toast.ts`.

## Bundled JSON — KJV

`assets/bible/kjv-1769.json` (~4.5 MB) is bundled with the app and
serves all KJV reads. The resolver (`lib/bible/kjv-bundle.ts`) is
called from inside `fetchVerse` / `fetchChapter` as a short-circuit
that runs after the session-cache check and before the network
call. This means:

- KJV reads never hit the edge function
- KJV reads never increment `usage_daily` / `bible_fetch_count`
- KJV reads never populate `verse_cache`
- KJV works completely offline
- The session cache is still populated for KJV reads, so re-reading
  the same verse in a session is instant

The JSON is `require()`'d lazily on first KJV read; the parsed
object is cached in module scope after that. Non-KJV users pay no
startup cost for the bundle.

Source data was preprocessed once (`scripts/clean-kjv.js`) to strip
italics-bracket artifacts (`[is]` → `is`), strip leading `#`
paragraph markers, and normalize the `Solomon's Song` book name to
`Song of Solomon`. Re-run that script if the bundle is ever
replaced from upstream.

`lib/bible/index.ts` separately imports `assets/bible/structure.json`
(the canonical book/chapter list) for the Browse Bible UI; that's
unrelated to KJV serving.

## Invariants

1. **All Bible reads go through `fetchVerse` or `fetchChapter` in
   `lib/api/bible.ts`.** Never read JSON directly, never call the
   edge function ad-hoc. The session cache and rate limiting only
   work if you go through this layer.
2. **Normalize the reference before caching or comparing.**
   `normalizeReference` (server) and the parsing in `lib/bible/`
   (client) are the only places that should produce a cache key.
3. **Adapter responses must be normalized to
   `{ verses: { [n]: text } }` before caching.** Single verses get
   wrapped as `{ [n]: text }`. Ranges keep the full keyed map.
4. **Rate limit fires *before* the cache check.** Cache hits still
   count. Don't move the rate limit after the cache check to "save
   quota" — that defeats per-user fairness.
5. **LRU eviction happens at insert time, not lazily.** Don't
   assume the DB cache can hold unbounded rows.
6. **Verse-count validation is the only completeness signal.** Use
   `getExpectedVerseCount`; don't guess from response length.
7. **KJV reads short-circuit inside `fetchVerse` / `fetchChapter`
   before the network call.** The local-bundle resolver
   (`lib/bible/kjv-bundle.ts`) returns a `BibleVerse` /
   `ChapterResponse` of the same shape the network path would have
   returned. Don't add a parallel KJV-only read function; the
   integration must stay inside the existing layer so the session
   cache and rest of the pipeline behave consistently.

## Sharp edges

- A version with intentionally missing verses (some translations
  omit certain passages) currently fails the completeness check and
  re-fetches every time. There is no version-aware verse count.
- The `verse_cache` table has no RLS; public-API access *should*
  be revoked. See `docs/operations/security-todo.md`.
- The `bible_fetch_count` increment is in `usage_daily`, but
  there's no separate counter per *version* — a heavy NIV user
  competes for the same 100/day quota as their ESV use.
- Eviction is based on `last_used_at` per version, but the
  `bump-on-read` is fire-and-forget. Under load, two concurrent
  reads of the same verse may double-bump or race; harmless but
  not ordered.
