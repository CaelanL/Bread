# Edge Functions

Edge functions are Deno scripts running on Supabase infrastructure.
They handle the things that need a server — secrets, rate limiting,
external API calls, and writes to shared tables.

There are four functions: `bible`, `process-recording`,
`transcription-token` and `send-notifications`. Shared code lives in
`_shared/`.

## Functions

```
supabase/functions/
├── _shared/
│   ├── auth.ts          ← User auth (verifyJwt, getAuthUser), admin client, tier lookup
│   ├── cors.ts          ← CORS headers and preflight
│   ├── errors.ts        ← Standard error responses
│   └── usage.ts         ← Usage metering (usage_daily)
├── bible/
│   ├── index.ts         ← HTTP entry point
│   ├── cache.ts         ← verse_cache reads/writes + LRU eviction
│   ├── normalize.ts     ← Reference normalization
│   ├── verse-counts.ts  ← Hardcoded chapter verse counts (validation)
│   └── adapters/
│       ├── types.ts     ← BibleAdapter contract
│       ├── esv.ts       ← Crossway ESV API
│       └── apibible.ts  ← API.Bible for NLT/NIV/NKJV
├── process-recording/
│   └── index.ts         ← Soniox upload, polling, optional GPT cleaning
├── transcription-token/
│   └── index.ts         ← Mints temp Soniox keys for live streaming
├── invite-handoff/
│   └── index.ts         ← Install handoff: record (sendlabs.dev page) and claim (navigation-and-routing.md#invite-handoff)
└── send-notifications/
    ├── index.ts         ← Cron entry point
    ├── push.ts          ← Expo Push client
    ├── types.ts
    └── sources/         ← One module per notification source
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

The batch transcription endpoint for the study session. **Transcribes
only — does not score.** The client side and when each path runs are
in `docs/features/transcription.md`.

```
POST /functions/v1/process-recording
  Content-Type: multipart/form-data
  Body: { audio: <blob>, durationMs: <number>, actualVerse: <string> }
  │
  ▼
1. verifyJwt(req)
2. Validate multipart fields (400/401 returned normally up to here)
3. Commit a 200 and start streaming: one heartbeat space every 10s
   while Soniox works (keeps the client socket alive past its ~60s
   idle timeout; leading whitespace is valid JSON so response.json()
   on any client parses unchanged)
4. Upload audio to Soniox async API (model stt-async-v5)
   - actualVerse passed as context for accuracy
5. Poll Soniox until transcription completes (every 250ms for the
   first 3s, then every 1s, up to a 90s deadline)
6. Record usage_daily.transcribe_seconds without blocking the
   response (EdgeRuntime.waitUntil). Analytics only — the quota gate
   was removed; nothing returns 429 anymore
7. Optionally run GPT-5-mini cleaning pass
   - CLEANING_ENABLED is HARDCODED FALSE right now
8. Stream the JSON payload
   { transcription, cleanedTranscription, cleaningUsed }
   - failures after step 3 can't change the committed 200 status;
     they ship as { error } in the body instead. The client checks
     the payload shape, not just response.ok.
```

The actual scoring (alignment + accuracy %) happens **on the
device** in `lib/align.ts` and `hooks/use-study-session.ts` — not
here. This function is just the audio → text bridge. A null transcript
from silent audio comes back as an empty string, so the client scores
0 instead of erroring.

### `actualVerse` as Soniox context

Soniox accepts a `context` parameter that primes the recognizer
with the expected text, along with `domain` and `topic` hints. Passing
the verse text noticeably improves accuracy on rare/biblical words
(e.g. "Selah", "Beelzebub"). Don't remove this without trade-off
analysis.

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

## `transcription-token`

Mints short-lived Soniox temporary API keys so the client can stream
audio **directly** to Soniox's real-time WebSocket during recording
(`lib/transcription/live-session.ts`) — the edge function never
touches audio bytes. See `docs/features/transcription.md`.

```
POST /functions/v1/transcription-token
  Headers: Authorization: Bearer <supabase JWT>
  Body: none

200 → { apiKey, expiresAt, websocketUrl, model: "stt-rt-v5" }
403 → { error: "LIVE_DISABLED" }   ← the kill switch
500 → Soniox not configured or the mint failed
```

- **Kill switch**: unless the `LIVE_TRANSCRIPTION_ENABLED` secret is
  exactly `"true"`, every request gets 403 and every client silently
  falls back to the batch path from its next mint (an open study
  screen reuses its key for up to 270s). Flip with
  `supabase secrets set LIVE_TRANSCRIPTION_ENABLED=true|false` — no
  deploy, no store release.
- Temp keys: 300s TTL (gates connection establishment only, not the
  session; a study screen reuses one key for up to 270s), `max_session_duration_seconds: 315` (client's 300s cap
  timer fires first), `client_reference_id: user.id` (per-user
  attribution in the Soniox console).
- The client treats *any* non-200 as "use batch" — this endpoint can
  never break recitation scoring.
- Old clients never call it; purely additive.

## `send-notifications`

Called by `pg_cron` every minute through `pg_net`. It takes no user
JWT: it compares the bearer token in constant time against the
`cron_secret` in Vault, read through the `get_cron_secret()` RPC and
re-read once on a mismatch so rotation works. Then it runs each
notification source in turn. See `docs/features/notifications.md`.

## `_shared/auth.ts`

All functions set `verify_jwt = false` in `supabase/config.toml`, so
the gateway doesn't check tokens and each function checks its own.

- `verifyJwt(req)` verifies an ES256 token locally against the
  project's JWKS (keys cached per worker) and returns the user, or
  `null`. Used by `process-recording` and `transcription-token`.
- `getAuthUser(req)` asks Supabase Auth with the user's token, a
  network call. Used by `bible`.
- `getAdminClient()` is the service-role client that bypasses RLS.
- `getUserTier(userId)` reads `subscriptions`. No row or an expired
  one means `free`.

## `_shared/usage.ts`

`checkAndIncrementBibleUsage(userId)`:

1. Look up user's tier via `getUserTier(userId)`.
2. Look up today's usage in `usage_daily` (one row per
   `user_id × date`).
3. If under limit → increment and allow.
4. If over → `{ allowed: false, used, limit }`, and the function
   answers with `rateLimitResponse`, which adds `resetsAt`.

Tier limits:

| Counter | Free | Supporter | Enforced? |
|---|---|---|---|
| `bible_fetch_count` | 100/day | 10,000/day | yes |
| `transcribe_seconds` | 300/day | 3,600/day | no, recorded only |
| `evaluate_count` | 20/day | 500/day | no, legacy |

`evaluate_count` is from the era when scoring was an OpenAI call.
Keep the column for now (existing rows reference it) but new code
shouldn't increment it. The only call left is in the disabled cleaning
path.

## Secrets

Edge functions need:

- `ESV_API_KEY` — Crossway
- `API_BIBLE_KEY` — API.Bible
- `SONIOX_API_KEY` — Soniox
- `LIVE_TRANSCRIPTION_ENABLED` — `"true"` enables the
  `transcription-token` endpoint; anything else (or unset) is the
  live-transcription kill switch
- `EXPO_ACCESS_TOKEN` — Expo Push, for `send-notifications`
- `OPENAI_API_KEY` — only if GPT cleaning is re-enabled
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — to read/write
  `verse_cache`, `usage_daily`, `subscriptions` past RLS
- `SUPABASE_ANON_KEY` — for `getAuthUser`'s user-token client
- `HANDOFF_SALT` — HMAC key for `invite-handoff`'s network hash; unset falls back to a
  plain hash (and logs a warning). Not set in prod yet: needs Caelan's yes
  ([release.md](release.md)). After each deploy, check once that the last
  `x-forwarded-for` hop is the caller's real IP (record from two networks, claim from one).

These are set via `supabase secrets set ...` and never appear in
the client bundle. `cron_secret` lives in Vault instead; locally,
`supabase/config.toml` provides a throwaway value.

## Deployment

Functions deploy through `npm run release`, never by hand.
`deployFunctions` in `scripts/release.mjs` deploys each function whose
folder changed against `origin/main`, or all of them if `_shared/`
changed. It runs because `kit.deployFunctions` is true in
`package.json`. See `docs/architecture/release.md`.

They go live right after step 5, before the client, so old clients
must keep working. See "Migration safety" in
`docs/architecture/data-model.md`.

Local development:

```
supabase functions serve --env-file ./supabase/functions/.env
```

## Invariants

**Invariant 9: the service role key must never reach the client.**
It's used only in edge functions. The anon key is what the app ships
with, and RLS enforces ownership via `auth.uid() = user_id`. Leaking
the service role key effectively voids all RLS.

Also:

1. **Every edge function authenticates before anything else.** No
   open endpoints: `verifyJwt` or `getAuthUser` for user-facing
   functions, the cron secret for `send-notifications`. Even rate
   limiting depends on having a user ID.
2. **Use the service role key inside edge functions, the anon key
   in the client.** Don't accidentally use the anon key for shared
   tables inside an edge function — it would re-trigger RLS where you
   don't want it to.
3. **Rate-limit before doing real work.** The check is cheap, the
   work (external API call) is expensive. Order matters.
4. **`process-recording` does not score.** It transcribes. Scoring
   is on the device. If you find yourself adding accuracy logic
   here, stop and reconsider — moving it server-side is a real
   architecture change.
5. **`actualVerse` as Soniox context is load-bearing.** Don't drop
   it; word-error rate on biblical names jumps significantly
   without it.
6. **`process-recording` must never go silent for 60s+.** The
   streamed heartbeat exists because iOS kills a socket after ~60s
   without data; if you restructure the function, keep bytes
   flowing while Soniox works.
7. **Keep `process-recording`'s request and response shape.** Old
   clients still call it, and any client falls back to it when live
   transcription isn't available.

## Sharp edges

- **GPT cleaning code path is dead code that still exists.** Easy
  to accidentally re-enable by flipping a flag without thinking
  through the consequences.
- **Soniox polling can take up to ~90 seconds.** The response
  heartbeat keeps clients alive through it, but the Supabase
  runtime wall-clock (~150s) still bounds the whole request.
- **`usage_daily` increments aren't atomic.** `incrementUsage` reads
  then writes, so concurrent requests can undercount.
- **`transcription_locks` table is orphaned.** The table and its
  cleanup function exist in the schema, but no code ever acquires
  a lock. The only double-submit guard is the client UI disabling the
  mic while transcribing.
- **No retry logic on external API failures.** If ESV / API.Bible
  / Soniox returns 5xx, the function returns 500 to the client
  with no automatic retry.
- **`evaluate_count` column is legacy** (from when scoring was an
  OpenAI call). Still in the schema; don't read it.
- **No version-aware verse counts** — adapters log a warning when
  the parsed count doesn't match VERSE_COUNTS, but don't fail or
  fall back. See `docs/architecture/bible-versions.md`.
- **`_shared/usage.ts` has unused helpers.** `getTierAndUsage` calls
  an RPC no migration defines, and the transcription and evaluation
  checks have no callers.

## Decisions

- 2025-12-19 · Scoring moved to the device, `process-recording` only transcribes · No LLM in the scoring path. The GPT cleaning code stays behind a hardcoded `false`.
- 2025-12-23 · Quota check removed from `process-recording`, usage still recorded · Limits can come back on the server without an app update.
- 2026-08-24 · `process-recording` streams heartbeat spaces every 10s · Long recordings tripped the client's ~60s idle timeout. Leading whitespace is valid JSON, so old clients parse unchanged.
- 2026-08-25 · Live transcription gated by a server-side kill switch, batch path kept · A secret flip needs no deploy or store release, and any failure falls back to batch.
