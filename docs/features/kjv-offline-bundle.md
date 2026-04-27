# Feature: KJV Offline Bundle

> **Status:** `shipped`
> **Author:** Caelan
> **Created:** 2026-04-27
> **Shipped:** 2026-04-27

## Problem

KJV is currently broken for the user. The app routes KJV requests to
the API.Bible adapter (sharing the same `API_BIBLE_KEY` as NLT/NIV/NKJV),
but the user's API.Bible plan has hit its translation cap and KJV is
the version that got kicked off. Result: every KJV verse load fails
with a 500 from the edge function. Users who saved verses in KJV
can't study them. The Settings UI still offers KJV, so new users can
also fall into this hole.

KJV is unique among supported translations: it is **public domain**.
We can ship its full text with the app and never depend on a server
for KJV again. The 4.5 MB `assets/bible/kjv-1769.json` is already
bundled — it has been since before the API migration — but per
`docs/architecture/bible-api-and-caching.md` it is currently dead
weight, not wired up.

## Solution

Wire the bundled KJV JSON into the existing read pipeline by
short-circuiting `fetchVerse()` and `fetchChapter()` in
`lib/api/bible.ts` for `version === "KJV"` *after* the session-cache
check and *before* the network call.

For KJV requests, we:

1. Look the verse(s) up in the bundled JSON
2. Return the same `BibleVerse` / `ChapterResponse` shape the network
   path returns
3. Still populate the session cache for free perf consistency
4. **Never** call the edge function, never increment the rate limit,
   never touch `verse_cache`

Net result: KJV becomes the only translation that works **fully
offline**, has zero quota cost, and zero API.Bible dependency.

## Requirements

### Must have

- [ ] KJV verse fetches resolve from the bundled JSON, not the network
- [ ] All five user-facing surfaces that consume Bible text work for
      KJV: study session, library save flow, browse-Bible chapter
      reader, verse picker preview, VOTM rendering
- [ ] The bundled JSON is loaded lazily (require'd on first KJV read,
      not at app startup) so non-KJV users don't pay a startup cost
- [ ] Bracket-stripping (`[was]` → `was`) and paragraph-marker
      stripping (`#` prefix) happen during a one-time preprocessing
      step, baked into the file we ship — not at runtime per read
- [ ] Saved KJV verses re-load correctly on app restart and after
      sign-in on a new device
- [ ] If a user is offline and their saved verses are KJV, the study
      session still works end-to-end

### Nice to have

- [ ] An offline-capable indicator somewhere subtle in the UI (e.g.
      a small badge on the KJV row in the version selector) so users
      know KJV works without internet
- [ ] Drop the API.Bible KJV registration on the server side
      (`supabase/functions/bible/index.ts` adapters map, and the
      `BIBLE_IDS.KJV` entry in apibible.ts) since we'll never route
      there again

### Explicitly out of scope

- Bundling other translations (ESV, NLT, NIV, NKJV are licensed —
  not bundleable)
- Search across the full Bible text (KJV-local would unlock this for
  KJV users only, but cross-translation search is a separate feature)
- A general "offline mode" — only KJV reads become offline; saving
  verses, syncing progress, transcription, etc. all still need
  network
- Migrating users on other translations to KJV — version stickiness
  per saved verse is preserved

## Resolved Decisions

- **Q1 — Rate limiter: bypass entirely.** KJV reads never increment
  `usage_daily`. The whole point is no network. Loses per-version
  observability of KJV usage, which is acceptable.
- **Q2 — Lazy-load.** Module-level `require()` triggered on first
  KJV read; subsequent reads hit the in-process cache. App startup
  is unaffected for non-KJV users.
- **Q3 — Preprocess once, commit clean JSON.** A one-shot script
  (`scripts/clean-kjv.ts`) strips brackets and `#` markers; we
  commit the output. Source provenance is documented in the
  script. Diff is reviewable.
- **Q4 — Strip during preprocessing (follows Q3).** Scoring sees
  clean text; one canonical source. The bracketed words ARE kept
  (only the brackets are stripped) — those words are required for
  English grammar and are part of the verse as it reads.
- **Q5 — Remove server-side KJV registration.** Drop `KJV` from
  the adapter map and from `BIBLE_IDS`. Step has to land *after*
  the client-side change is shipped to users so old-app users
  don't lose KJV.
- **Q6 — Verse count: bundle is responsible for completeness.**
  Local resolver always returns all verses in a chapter (or the
  range requested). Verifies during preprocessing that every
  chapter's verse count matches `assets/bible/structure.json`.
- **Q7 — VOTM with KJV.** Should be transparent — VOTM calls
  `fetchVerse`, which short-circuits to the bundle for KJV.
  Confirm during testing.
- **Q8 — Existing user_verses with `version: "KJV"`.** No
  migration needed; the fix routes them to the bundle on next
  app open after the user updates.

## Data audit findings

Before writing the script we scanned all 31,102 verses across all
66 books to confirm what artifacts actually appear:

| Artifact | Count | Notes |
|---|---|---|
| `[brackets]` | 14,233 verses | 44% of all verses |
| `#` prefix | 2,936 verses | Paragraph markers |
| Non-ASCII characters | 0 | Fully clean ASCII |
| Curly braces, angle brackets, asterisks, underscores, pilcrows, tabs, doubled spaces, trailing spaces | 0 | None |

The bundle is shockingly clean — only the two known artifacts. No
Unicode, no encoding weirdness, no leftover footnote markers.

A 132-verse random sample (2 verses from each book) confirmed:
- Brackets always wrap meaningful words, never empty
- Multi-bracket verses (`[Art] thou Joab? And he answered, I [am he]`)
  strip cleanly with a single regex pass
- Brackets at start of verse (`[And] when thy son asketh thee...`)
  produce correctly capitalized output after strip
- Apostrophes are regular ASCII (`God's`, `mother's`); no curly quotes
- Long bracketed phrases (`[suffer yourselves to]` in 1 Cor 6:7) read
  naturally after strip

## Cleanup regex

The script uses three sequential passes:

```ts
text.replace(/\[([^\]]+)\]/g, '$1')   // strip brackets, keep contents
    .replace(/^#\s*/, '')              // strip leading # marker
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim();
```

Plus a post-processing validation: confirm every chapter's verse
count matches `structure.json`. Failure aborts the script.

## Technical Approach

> *To be filled in after Open Questions are resolved. Sketch below for
> orientation.*

### Files added

- `lib/bible/kjv-bundle.ts` — Module that lazy-loads + parses the
  bundled JSON, exposes `getKjvVerse(book, chapter, verse) /
  getKjvVerseRange(book, chapter, start, end) /
  getKjvChapter(book, chapter)` returning data in the same shape
  that the network path returns (so callers don't need to special-case).
- `scripts/clean-kjv.ts` — One-shot preprocessing script (assuming
  Q3 = A). Strips `[...]` brackets and `#` prefixes. Run once,
  commit output.

### Files modified

- `lib/api/bible.ts` — `fetchVerse` and `fetchChapter` get a short-
  circuit at the top of the function (after session cache, before
  network) for `version === "KJV"`. Returns the same shape; also
  populates the session cache for repeat-read speed.
- `assets/bible/kjv-1769.json` — Replaced with cleaned output of the
  preprocessing script.
- `supabase/functions/bible/index.ts` — Remove `KJV: apiBibleAdapter`
  from the `adapters` map (assuming Q5 = A).
- `supabase/functions/bible/adapters/apibible.ts` — Remove KJV from
  `BIBLE_IDS`.

### State changes

None. The Zustand store, AsyncStorage, and `user_verses` schema all
remain identical. Saved verses with `version: "KJV"` continue to
work; what changes is *where* the text comes from.

### UI

Optional: a small "Available offline" badge next to KJV in the
version selector (Settings tab). Spec out only if Q1's nice-to-have
is in scope. Otherwise zero UI changes — the bug just goes away.

### Edge cases

- **Offline + KJV study:** works end-to-end since no network is
  needed for verse text. (Saving progress and submitting recordings
  still need network.)
- **JSON parse failure at runtime:** would be a hard crash on first
  KJV use. Mitigation: wrap the lazy-load in a try/catch, fall back
  to throwing a user-visible error. Acceptable since the bundle is
  shipped with the app and parse-tested in CI.
- **Verse missing from bundle (e.g. wrong reference):** resolver
  returns null; `fetchVerse` throws like it would for any other
  not-found verse. Existing error UI catches this.
- **Concurrent first-read race:** module-scope cache + JS
  single-threadedness means no real race. The lazy require runs
  once.

### What does NOT change

- Edge function adapter pattern, version selector UI, save flow,
  scoring logic, alignment library, the rate limiter, the Postgres
  `verse_cache` (KJV just doesn't write to it anymore), session
  cache shape, `user_verses` schema, all five other translations'
  paths.
- KJV does not become the default. Default stays ESV.

## Build order

Each chunk is a PR-sized commit that leaves the app in a working
state.

### Chunk 1 — Preprocessing script + cleaned JSON

Branch: `kjv-offline-1-clean-data`

Goal: regenerate `assets/bible/kjv-1769.json` with brackets and `#`
markers stripped, plus a verse-count validation step. App behavior
unchanged (the file is still unused at this point).

Files:
- `scripts/clean-kjv.ts` — new file, one-shot script. Reads the
  current bundle, applies the regex passes from "Cleanup regex"
  above, validates verse counts against `structure.json`, writes
  back the cleaned JSON. Documents source provenance in a comment.
- `assets/bible/kjv-1769.json` — replaced with the script's output.
  Diff in the PR will show only stripped artifacts; no real text
  changes.
- `package.json` — add a script entry: `"clean-kjv": "tsx
  scripts/clean-kjv.ts"`.

Validation in PR review: spot-check `Genesis 1:6` (had `#`),
`Genesis 1:2` (had `[was]`), and a few other sampled artifact-heavy
verses to confirm clean output.

### Chunk 2 — Local KJV resolver module

Branch: `kjv-offline-2-resolver`

Goal: add a module that loads the bundled JSON lazily and exposes
the same `BibleVerse` / `ChapterResponse` shape that the network
path returns. Not yet integrated with `fetchVerse`/`fetchChapter`.
App behavior still unchanged.

Files:
- `lib/bible/kjv-bundle.ts` — new file, exports:
  - `getKjvVerse(book, chapter, verse, verseEnd?)` →
    `{ reference, version: "KJV", text, verses, cached: true }`
    (mirrors `BibleVerse` shape including the `verses` keyed map)
  - `getKjvChapter(book, chapter)` →
    `{ reference, version: "KJV", verses, cached: true }`
    (mirrors `ChapterResponse`)
  - Lazy-loads the JSON via `require()` inside the resolver
    functions. Module-scope variable caches the parsed object.
  - Throws a descriptive error if a verse/chapter isn't found in
    the bundle (caller decides how to surface).

### Chunk 3 — Wire the short-circuit into the read path

Branch: `kjv-offline-3-integrate`

Goal: KJV requests bypass the network. User-visible bug fix.

Files:
- `lib/api/bible.ts` — in `fetchVerse`, after the session-cache
  check and before the network call, add:
  ```ts
  if (version === "KJV") {
    const result = getKjvVerse(...);
    setVerseInSession(...);  // populate session cache for consistency
    return result;
  }
  ```
  Same pattern in `fetchChapter` and `getVerseText` if it has a
  separate path (verify during build). `cached: true` is correct
  semantically — the bundle IS a cache.

Also: confirm the rate-limit bypass. Since the short-circuit
returns before the `fetch()` call to the edge function, KJV reads
naturally never hit `checkAndIncrementBibleUsage`. No extra work
needed for Q1.

### Chunk 4 — Verify all surfaces

Branch: same as Chunk 3 or follow-up.

Goal: confirm every Bible-text consumer works for KJV. Not new
code — testing + spot-fix of any surface that has its own read
path that doesn't go through `fetchVerse`/`fetchChapter`.

Surfaces to verify on a real device with KJV selected:
- Study session — full session start to finish, all 3 difficulties
- Library save flow — saving a new KJV verse
- Browse Bible chapter reader — loading a full chapter
- Verse picker preview — preview text in the picker
- VOTM home tile — current month's verse rendered in KJV

If any surface bypasses `fetchVerse`/`fetchChapter`, it needs
fixing in this chunk, OR it violates invariant #3 and should be
fixed regardless.

### Chunk 5 — Remove server-side KJV registration

Branch: `kjv-offline-5-server-cleanup`

**Important:** this lands *after* the client change has shipped to
users (TestFlight or App Store). If we drop the server adapter
before the client is deployed, old-app users still routing KJV to
the server will get hard errors.

Files:
- `supabase/functions/bible/index.ts` — remove `KJV: apiBibleAdapter`
  from the `adapters` map. Add a comment noting that KJV is served
  client-side from the bundled JSON.
- `supabase/functions/bible/adapters/apibible.ts` — remove `KJV:
  "a6aee10bb058511c-02"` from `BIBLE_IDS`. Update the "Supports:"
  comment in the file header.

Deploy: `supabase functions deploy bible`.

### Chunk 6 — Doc graduation + sharp-edges cleanup

Files:
- `docs/architecture/bible-api-and-caching.md` —
  - Update the "Bundled JSON" section: KJV now served from bundle.
  - Update invariant #7 in that doc: bundled JSON IS the KJV
    fallback now; the integration is in `fetchVerse` /
    `fetchChapter`.
  - Add KJV to the "what bypasses the rate limiter" list.
- `docs/architecture/bible-versions.md` —
  - Update the "Currently supported versions" table: KJV source
    becomes "Bundled (1769 ed.)".
  - Update the "Bundled vs fetched" section.
- `CLAUDE.md` — update sharp-edges:
  - Remove "`assets/bible/kjv-1769.json` (4.5MB) is bundled but
    never used" entry.
  - Optionally add a positive entry: "KJV is served from a bundled
    JSON; works offline."
- `docs/features/kjv-offline-bundle.md` — flip status to `shipped`,
  fill in "What Was Built", check graduation boxes.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-04-27 | Feature opened | KJV broken in prod due to API.Bible plan cap; bundled JSON exists but unused; public domain makes bundling licensing-safe |

## Graduation Checklist

- [x] New API or cache behavior reflected in `docs/architecture/bible-api-and-caching.md`
- [x] New version source reflected in `docs/architecture/bible-versions.md`
- [x] CLAUDE.md sharp-edges entry updated (`kjv-1769.json` no longer "bundled but never used")
- [x] CLAUDE.md invariant #3 updated to reference the bundle short-circuit pattern

## What Was Built

Shipped exactly as planned, in a single PR (build chunks consolidated):

1. **`scripts/clean-kjv.js`** — preprocessing script that strips
   bracket artifacts, hash markers, and renames `Solomon's Song` to
   `Song of Solomon`. Validates verse counts against
   `structure.json`. Idempotent.
2. **`assets/bible/kjv-1769.json`** — regenerated with cleaned data.
   17,286 verses cleaned, 117 keys renamed. All chapter counts
   validated.
3. **`lib/bible/kjv-bundle.ts`** — local resolver. Lazy-loads the
   JSON, exposes `getKjvVerse()` and `getKjvChapter()` returning
   the same shapes as the network path.
4. **`lib/api/bible.ts`** — short-circuits in `fetchVerse` and
   `fetchChapter` for `version === "KJV"`, after session cache,
   before network call. Populates session cache for consistency.
5. **`supabase/functions/bible/index.ts`** — removed `KJV` from the
   adapter map.
6. **`supabase/functions/bible/adapters/apibible.ts`** — removed
   `KJV` from `BIBLE_IDS`.
7. Architecture docs (`bible-api-and-caching.md`,
   `bible-versions.md`) updated. CLAUDE.md sharp-edge entry +
   invariant #3 updated.

The Song-of-Solomon naming inconsistency surfaced during validation
and was fixed at preprocessing time rather than added as a runtime
mapping — cleaner data, no ongoing translation cost.

**Rollout note:** The server-side adapter changes (steps 5-6) only
take effect when the bible function is redeployed via
`supabase functions deploy bible`. The client-side change (steps
1-4) ships with the next App Store update. Sequencing: deploy
server changes only **after** the client version is live, so old
app installations still work for a few days while users update.
