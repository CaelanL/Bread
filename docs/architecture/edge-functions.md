# Edge Functions

> **Status: Living document.** Update when an edge function is added,
> when shared utilities change, or when an external API integration
> changes. Read before touching `supabase/functions/`.

Edge functions are Deno scripts running on Supabase infrastructure.
They handle the things that need a server — secrets, rate limiting,
external API calls, and atomic operations on shared tables.

There are two production functions: `bible` and `process-recording`.
Shared code lives in `_shared/`.

## Functions

```
supabase/functions/
├── _shared/
│   ├── auth.ts          ← JWT verification (verifyJwt)
│   └── usage.ts         ← Tier lookup + usage metering (subscriptions, usage_daily)
├── bible/
│   ├── index.ts         ← HTTP entry point
│   ├── cache.ts         ← verse_cache reads/writes + LRU eviction
│   ├── normalize.ts     ← Reference normalization
│   ├── verse-counts.ts  ← Hardcoded chapter verse counts (validation)
│   └── adapters/
│       ├── types.ts     ← BibleAdapter contract
│       ├── esv.ts       ← Crossway ESV API
│       └── apibible.ts  ← API.Bible for KJV/NLT/NIV/NKJV
└── process-recording/
    └── index.ts         ← Soniox upload, polling, optional GPT cleaning
```

## `bible`

The verse-fetching API. See
`docs/architecture/bible-api-and-caching.md` for the full pipeline,
adapter contract, cache layers, and rate limiting. Quick summary
here:

- `GET /functions/v1/bible?ref=<ref>&version=<v>[&chapter=true]`
- Auth → rate limit → DB cache → adapter → cache write → respond
- Returns `{ reference, version, text?, verses?, cached }`
- Errors: 401 (auth), 400 (bad ref/version), 429 (rate limit), 500
  (upstream)

## `process-recording`

The transcription endpoint for the study session. **Transcribes
only — does not score.**

```
POST /functions/v1/process-recording
  Content-Type: multipart/form-data
  Body: { audio: <blob>, durationMs: <number>, actualVerse: <string> }
  │
  ▼
1. verifyJwt(req)
2. Acquire transcription_locks row for the user
   (prevents double-tap spam — 5 min TTL handled by cleanup function)
3. Increment usage_daily.transcribe_seconds (against subscription tier)
4. Upload audio to Soniox async API
   - actualVerse passed as context for accuracy
5. Poll Soniox until transcription completes (up to 60s)
6. Optionally run GPT-5-mini cleaning pass
   - CLEANING_ENABLED is HARDCODED FALSE right now
7. Release transcription_locks row
8. Return { transcription, cleanedTranscription, cleaningUsed }
```

The actual scoring (alignment + accuracy %) happens **on the
device** in `lib/align.ts` and `hooks/use-study-session.ts` — not
here. This function is just the audio → text bridge.

### `actualVerse` as Soniox context

Soniox accepts a `context` parameter that primes the recognizer
with the expected text. Passing the verse text noticeably improves
accuracy on rare/biblical words (e.g. "Selah", "Beelzebub"). Don't
remove this without trade-off analysis.

### Cleaning pass

There's a code path that calls OpenAI GPT-5-mini to clean up the
raw Soniox transcription (remove filler words, fix obvious
miscaptures). The flag is **hardcoded false** in `index.ts`. If
re-enabled:

- Adds 2–5 seconds of latency per recording.
- Adds OpenAI cost per recording.
- The prompt assumes the user is *reciting*, not *reading*. If
  used in a read-back scenario it may strip words incorrectly.

Don't enable without product input.

## `_shared/auth.ts`

Exports `verifyJwt(req)` which:

1. Extracts `Authorization: Bearer <token>` from the request.
2. Verifies the JWT with Supabase's auth helpers.
3. Returns the user ID, or throws 401.

Every function call goes through this first.

## `_shared/usage.ts`

Exports `checkAndIncrementBibleUsage(userId)` and the equivalent
for transcription:

1. Look up user's tier via `getUserTier(userId)` — checks
   `subscriptions` table. Defaults to `free`.
2. Look up today's usage in `usage_daily` (one row per
   `user_id × date`).
3. If under limit → increment and allow.
4. If over → return `{ allowed: false, used, limit, resetsAt }`.

Tier limits:

| Counter | Free | Supporter |
|---|---|---|
| `bible_fetch_count` | 100/day | 10,000/day |
| `transcribe_seconds` | (limit defined here) | (limit defined here) |
| `evaluate_count` | (legacy — see file) | |

`evaluate_count` is from the era when scoring was an OpenAI call.
Keep the column for now (existing rows reference it) but new code
shouldn't increment it.

## Secrets

Edge functions need:

- `ESV_API_KEY` — Crossway
- `API_BIBLE_KEY` — API.Bible
- `SONIOX_API_KEY` — Soniox
- `OPENAI_API_KEY` — only if GPT cleaning is re-enabled
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — to read/write
  `verse_cache`, `usage_daily`, `subscriptions` past RLS

These are set via `supabase secrets set ...` and never appear in
the client bundle.

## Deployment

```
supabase functions deploy bible
supabase functions deploy process-recording
```

Local development:

```
supabase functions serve --env-file ./supabase/.env.local
```

The Supabase CLI version checked in is 2.78.1 (per the
installed binary).

## Invariants

1. **Every edge function call starts with `verifyJwt(req)`.** No
   public endpoints. Even rate limiting depends on having a user ID.
2. **Use the service role key inside edge functions, the anon key
   in the client.** Don't accidentally use the anon key inside an
   edge function — it would re-trigger RLS where you don't want it
   to.
3. **Rate-limit before doing real work.** The check is cheap, the
   work (external API call, Soniox poll) is expensive. Order
   matters.
4. **`process-recording` does not score.** It transcribes. Scoring
   is on the device. If you find yourself adding accuracy logic
   here, stop and reconsider — moving it server-side is a real
   architecture change.
5. **`actualVerse` as Soniox context is load-bearing.** Don't drop
   it; word-error rate on biblical names jumps significantly
   without it.
6. **`transcription_locks` releases must run in `finally`.** A
   crash that leaves a lock behind blocks the user for 5 minutes
   until cleanup. Always release on every exit path.

## Sharp edges

- **GPT cleaning code path is dead code that still exists.** Easy
  to accidentally re-enable by flipping a flag without thinking
  through the consequences.
- **Soniox polling can take up to 60 seconds.** If the function
  runtime cap is hit, you'll get a generic timeout from Supabase
  rather than a useful error. Worth tightening the polling
  ceiling.
- **No retry logic on external API failures.** If ESV / API.Bible
  / Soniox returns 5xx, the function returns 500 to the client
  with no automatic retry.
- **`evaluate_count` column is legacy** (from when scoring was an
  OpenAI call). Still in the schema; don't read it.
- **No version-aware verse counts** — adapters log a warning when
  the parsed count doesn't match VERSE_COUNTS, but don't fail or
  fall back. See bible-api-and-caching.md sharp edges.
