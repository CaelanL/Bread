# Bible API and Caching

A single endpoint — `GET /functions/v1/bible` — handles every Bible
text request that needs the network. It sits behind a 3-layer cache
(in-memory → Postgres → external API): most reads in a session are
instant, and the external APIs see far fewer requests. KJV skips the endpoint, see "Bundled JSON — KJV".

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
   (auth → DB cache → on a miss: limit → adapter)
        │
        ▼
┌──────────────────────────────────────┐
│  Layer 2: Postgres verse_cache table │  LRU eviction
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

The session cache is why opening the same verse twice in a session never hits the network.
`peekVerseText(verse)` reads it synchronously (no KJV bundle, no
network), so verse cards and the study session show text already in
memory on their first frame, with no loader. A card's failed read is tried
again when pull to refresh replaces its verse, with the failure text kept
until the answer (`hooks/use-verse-preview.ts`).

### Preloading verse text

The store warms the session cache through `warmVerseText`
(`preloadVerseText` in `lib/store/index.ts`; picker
`lib/store/preload.ts`, tested in `preload.test.ts`):

- At launch, once the first load and alignment settle and after
  `requestIdleCallback`: every verse once, most
  recently practiced first (never practiced last), then newest.
- Opening a collection (`[id].tsx`, Mastered and In Progress too) puts
  its verses at the front of the queue.
- `PRELOAD_CONCURRENCY` (3) at a time. KJV is skipped (bundled, no
  request). With Hide verses on nothing preloads; the text loads at
  Setup, which always loads its own verse.
- The queue stops on an account change and on the first 429
  (`DailyLimitError`), so warming never spends the rest of a day's
  limit. `refresh()` and a translation switch don't preload.
- A read someone waits on goes first: while any `fetchVerse`,
  `fetchChapter`, `getVerseText` or Home's Verse of the Month load
  (`foregroundRead` in `hooks/use-votm.ts`) is in flight, the preload
  starts no read (`whenForegroundIdle`). Its own in-flight reads finish.

Identical reads still in progress share one promise (`inFlight` in
`lib/api/bible.ts`), keyed by passage or chapter, reference and
translation. A collection's cards and the preload (below) often ask
for the same passage together, and make one request.
The entry is removed when the read succeeds or fails, so a failure
never blocks a retry. `clearSessionCache` doesn't touch in-flight
entries. Regression tests: `tests/bible-in-flight.test.mjs`.

Two rules, both from the Psalm 103 bug (see Decisions):

- **`verseCache` entries are always single-verse text.** Range fetches
  cache each verse individually from the API's keyed data — never the
  combined range text under the start verse. Regression tests:
  `lib/__tests__/study-chunks.test.ts`.
- **`fetchVerse` results carry keyed `verses` on every path, including
  session-cache hits.** The hit path assembles the keyed map from
  `verseCache` per-verse. If a range result ever lacks keyed data,
  `getVerseText` throws, like a failed fetch, and never fabricates
  `{ start: wholeText }`. The fabricated shape put the entire passage
  in chunk 1 and left every other chunk empty, and the sentence
  splitter that replaced it misplaced words.

### Layer 2 — Postgres `verse_cache`

`supabase/functions/bible/cache.ts` and the `verse_cache` table
(see `docs/architecture/data-model.md`).

- One row per `(book, chapter, verse, version)` — verse-level
  granularity. This is what makes overlapping ranges share storage
  (John 3:16-18 and John 3:17-20 share rows 17–18).
- LRU: `last_used_at` is bumped fire-and-forget on every read.
  `cacheVerse` and `cacheChapter` call `evictOldestVerses` before
  insert (never lazily). It picks the oldest rows by `last_used_at`, queries the table
  directly and doesn't use the SQL helpers. Eviction has known gaps,
  see Sharp edges.
- Completeness validation: a chapter is "fully cached" only when
  the row count for `(book, chapter, version)` reaches the expected
  count from `verse-counts.ts`. A partial chapter returns null and
  triggers a re-fetch. Ranges check for every verse in the range.
- Text revision: every write sets `text_rev` to `TEXT_REV` in
  `cache.ts`, and both reads (`getCachedVerses`, `getCachedChapter`)
  filter on it. A row from older parsing is a miss, and the
  upsert overwrites it. Bump `TEXT_REV` whenever an adapter's output
  changes.
- The 500-per-version figure comes from ESV/NLT licensing.

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

Each adapter has one pure parser for both its verse and chapter
paths, in its own file with no Deno globals or imports, so
`lib/__tests__/bible-adapters.test.ts` tests it under Node on
synthetic fixtures (KJV or made-up words in each upstream's shape,
never licensed text). Both paths ask with verse numbers on, and the
verse path keeps only the asked verse, so a psalm title, "Psalm N" heading or
stanza name before it is dropped. A single verse the translation
omits throws "Verse not found": the function answers 500 and caches
nothing.

**ESV adapter** (`adapters/esv.ts`, parser `parseEsvPassage` in
`adapters/esv-parse.ts`): Crossway `api.esv.org`. Auth:
`Authorization: Token ${ESV_API_KEY}`. Plain text with `[n]` verse
numbers. The parser drops Psalm 119 stanza names and Song of Solomon
speaker labels printed as their own paragraph, bracketed manuscript notes,
and the double brackets around passages like Mark 16:9-20. Crossway
reads `Jude 1` as Jude 1:1, so `esvChapterQuery` asks a one-chapter
book for `<book> 1:1-<n>`.

**API.Bible adapter** (`adapters/apibible.ts`): `rest.api.bible`.
Auth: `api-key: ${API_BIBLE_KEY}`. Bible IDs hardcoded:

| Version | Bible ID |
|---|---|
| NLT | `d6e14a625393b4da-01` |
| NIV | `78a9f6124f344018-01` |
| NKJV | `63097d2a0a2f7db3-01` |

References are converted to USFM codes (`John 3:16` → `JHN.3.16`).
A single verse is read from its chapter, so both paths parse the
same HTML with `parseApiBibleHtml` in `adapters/apibible-parse.ts`. Verses start at
`data-number="n"` spans. `cleanApiBibleText` turns tags into spaces
(no glued words), decodes entities and drops bracketed notes. A block holding only a Psalm 119 stanza name, or
a Hebrew letter and one word in any spelling (NKJV's "ס Samek"), is
dropped. NLT prints a dash rule after a verse, then a manuscript note or
an alternate ending inside the same verse span (Mark 16:8, John 7:52):
the verse ends at the rule. NIV has no text for Habakkuk 3:1. NLT's merged rows (`data-number="20-21"`) are keyed under the
first number; a single verse on the second gets the merged text,
uncached (`parseApiBibleVerse`).

## End-to-end flows

### Single verse — `John 3:16`, ESV

```
fetchVerse("John 3:16", "ESV")
  → session verseCache has "John:3:16:ESV"
      HIT  → return { text, verses: { 16: text }, cached: true }
      MISS ↓
  GET /functions/v1/bible?ref=John%203%3A16&version=ESV
    verifyJwt(req)                 local signature check
    validate version and reference
    getCachedVerses(...)  ∥  readBibleUsage(userId)  (tier ∥ today's row)
        HIT  → bump last_used_at, return with cached: true (no usage write)
        MISS ↓
    used >= limit → 429
    esvAdapter.fetchVerse("John 3:16", "ESV")  ∥  countBibleFetch(usage)
        verse absent (omitted) → 500, nothing cached
    return { reference, version, text, verses: { 16: text }, cached: false }
    then (EdgeRuntime.waitUntil) cacheVerse(...) → eviction step, upsert
  → session verseCache set per verse
```

### Verse range — `John 3:16-18`, ESV

```
fetchVerse("John 3:16-18", "ESV")
  → session verseCache has all of verses 16, 17, 18
      HIT  → assemble keyed map and combined text, cached: true
      MISS ↓
  GET /functions/v1/bible?ref=John%203%3A16-18&version=ESV
    getCachedVerses: one keyed read; text is its verses joined
        HIT  → return all 3 verses
        MISS (any verse missing) ↓ (limit and count as above)
    Strategy: fetch the FULL CHAPTER and extract the range
      esvAdapter.fetchChapter("John 3", "ESV", expectedCount=36)
      Extract verses 16–18 from the chapter result
    return { reference, version, text: combined, verses: {16,17,18}, cached: false }
    then cacheChapter(...) → upsert only those 3 verses
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
    esvAdapter.fetchChapter("John 3", "ESV", 36)   (limit and count as above)
    return { reference, version, verses: {1..36}, cached: false }
    then cacheChapter(...) → eviction step, then upsert
  → setChapterInSession also fills verseCache per verse
```

## Verse-count validation

`supabase/functions/bible/verse-counts.ts` exports a hardcoded
`VERSE_COUNTS` map: `book → number[]` (one entry per chapter).
`getExpectedVerseCount("John 3")` → `VERSE_COUNTS.John[2]` → `36`.

This is the only completeness signal for the cache; don't guess from
response length. Adapters log a warning if their parsed verse count
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

**Always normalize before keying.** `normalizeReference` runs once at
the top of the handler, and everything after it uses the result.
Otherwise the same verse can get cached under multiple keys, blowing
the LRU budget.

## Rate limiting

Only a server cache miss counts. `readBibleUsage` and
`countBibleFetch` (`supabase/functions/bible/usage.ts`) read the tier
and today's `usage_daily(user_id, date)` row alongside the cache read.
A hit answers with no usage write. A miss over the limit answers 429;
otherwise it counts one (on the row already read) while the external
fetch runs. A chapter or range miss counts one. On 429, the response
includes `used`, `limit` and a `resetsAt` of next midnight UTC. The
tier limits are in `docs/architecture/edge-functions.md`.

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

Every response, errors included, carries `Cache-Control: no-store`,
so licensed text never lands in an HTTP cache (`noStore` in
`supabase/functions/bible/index.ts`).

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

- KJV reads never hit the edge function, so never count toward the
  limit or populate `verse_cache`
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

`lib/bible/index.ts` imports `assets/bible/structure.json` (books and
chapters) for Browse Bible, unrelated to KJV serving.

## Invariants

**Invariant 2: verse text is NEVER stored in `user_verses`.** Verse text only lives in `verse_cache` (server, see Layer 2) and the
in-memory session cache, plus the KJV
bundle, which is public domain. If you find yourself adding a `text`
field to a user-owned table, stop. The optional `text` and `verses` on
the `SavedVerse` type are filled in memory and never written.

**Invariant 3: all Bible verse reads go through `fetchVerse()` /
`fetchChapter()` in `lib/api/bible.ts`.** Never read JSON files
directly from components/screens, never call the edge function ad-hoc.
The session cache, rate limiting, and KJV bundle short-circuit only
work if you go through this layer. `lib/bible/kjv-bundle.ts` is read
**only** from inside `fetchVerse`/`fetchChapter`. Don't add a parallel KJV-only read function.

Also:

- **Adapter responses must be normalized to
  `{ verses: { [n]: text } }` before caching.**

## Sharp edges

- **Eviction of cached verses has known gaps.** Read
  `evictOldestVerses` in `supabase/functions/bible/cache.ts` before
  relying on it or changing cache behavior.
- A version with intentionally missing verses fails the completeness
  check and re-fetches every time. See
  `docs/architecture/bible-versions.md`. The same holds for a range
  over an omitted verse: the keyed read wants every number, so it
  never hits and refetches the chapter each time.
- `fetchVerse` only short-circuits KJV when the reference has a verse.
  A chapter-only KJV reference to `fetchVerse` goes to the function and
  gets a 400. Use `fetchChapter`.
- The `bible_fetch_count` increment is in `usage_daily`, but
  there's no separate counter per *version* — a heavy NIV user
  competes for the same 100/day quota as their ESV use.
- Eviction is based on `last_used_at` per version, but the
  `bump-on-read` is fire-and-forget. Under load, two concurrent
  reads of the same verse may double-bump or race (harmless).

## Decisions

- 2025-12-19 · `user_verses.text` dropped, text kept only in `verse_cache` and memory · ESV/NLT licensing limits stored text to 500 verses per version.
- 2026-04-27 · Serve KJV from a bundled JSON and remove it from the adapter map and `BIBLE_IDS` · It's public domain, works offline, and costs no API quota.
- 2026-08-15 · Session `verseCache` holds single-verse text only, and `fetchVerse` always returns keyed `verses` · Combined range text under the start verse put a whole passage in chunk 1 (Psalm 103).
- 2026-11-14 · One parser per adapter, in a pure file tested from `lib/__tests__/` · Titles, stanza letters and "Psalm N" only reached the single-verse path because it parsed differently. `npm test` already globs there; a new test glob would change `package.json` and the native fingerprint.
- 2026-11-14 · An omitted single verse answers not found and isn't cached · Crossway answered with its neighbours, cached under the omitted number. `isAvailableIn` reads a failure as not available, and adding it fails visibly instead of making an empty chunk.
- 2026-11-15 · A single API.Bible verse is read from its chapter; a merged row keys and caches under its first number only · NLT tags a census table's first row with the next verse's id (Numbers 1-2); any other key repeats a row in a range.
- 2026-11-14 · A cached range is answered from one keyed read · Two reads could race, and a range answered with `verses: {}` fell to the sentence splitter.
- 2026-11-15 · Rows carry `text_rev`, and the ESV, NIV, NLT and NKJV rows were cleared in the same migration · Migrations apply before functions deploy, so an old function could refill a cleared row with old text in that gap; the new function reads only its own revision. Schema: `docs/architecture/data-model.md`.
- 2026-11-14 · The daily limit counts only server cache misses · Only a miss spends the external API's budget; a hit costs our own database and stores nothing new. Old clients get the same responses, with a 429 only on a miss.
- 2026-11-14 · Launch preload after first paint, 3 at a time, none with Hide verses on, stopping on a 429 · Previews still load for people who show them, without crowding the first paint or spending a day's limit.
