# Feature: Live Background Transcription

> **Status:** `planning`
> **Author:** Caelan (research by agents, 2026-08-16 — Soniox docs/pricing
> fetched live, usage from production DB, architecture verified in code)
> **Created:** 2026-08-16
> **Shipped:** —

## Problem

After a user finishes reciting and taps **done**, they sit through an
"Analyzing your recitation..." spinner while the app uploads the whole
m4a to a Supabase edge function, which uploads it to Soniox, creates an
async job, polls at 1s granularity (up to 60s), and fetches the
transcript. Four sequential HTTP round-trips after the user is already
finished. The wait is pure perceived latency — nothing is shown live,
and nothing needs to be.

Secondary problem the wait creates: the window between "last chunk
submitted" and "session logged" is exactly the transcription duration,
and it's unguarded — backgrounding or hardware-back during it silently
loses a fully-earned session (no AppState listener, no unmount save).

## Solution

Stream audio to Soniox's real-time API (`stt-rt-v5`, WebSocket) **in
the background during recording**. No live display — the transcript
accumulates silently. When the user taps done, the app sends the
end-of-stream frame, collects the final tokens (~hundreds of ms), and
scoring proceeds immediately. The spinner window collapses from
seconds to near-instant.

The existing batch path (`process-recording` edge function) is **kept
intact and untouched** as both the fallback and the kill switch:

- Recording still writes the m4a file exactly as today (dual-path).
- If the stream fails at any point — token mint refused, socket drops,
  finalize times out — the submit path falls back to the batch upload
  with the file. The user experience degrades to exactly today's flow.
- The kill switch is server-side: a new token-minting edge function
  refuses to mint → every client falls back to batch within one
  session, no deploy, no OTA.

Cost is a non-issue (see Cost model): lifetime Soniox usage since
Dec 2025 is 4.1 hours ≈ **$0.41**; real-time is ~$0.12/hr vs ~$0.10/hr
async. Projected delta at current usage: **pennies per month**.

## Cost model (research findings, 2026-08-16)

- **Usage to date** (server-side `usage_daily` meter): 244.7 min total
  since 2025-12-18. Recent months: 6–22 min/mo. Peak (launch, Mar
  2026): 96 min. 38 users ever; top 3 users = 62% of audio. Avg
  session 23s audio, p95 69s, max ever 277s.
- **Soniox pricing** (live, 2026-08-16): async ~$0.10/hr, real-time
  ~$0.12/hr (token-based; 1hr audio ≈ 30k input tokens @ $2.00/1M).
  No per-connection fee, no minimum increment. Max 300 min/stream.
- **Streaming bills full connection duration, not audio processed** —
  silence and idle time on an open socket count. Mitigation: socket
  opens at record-start, closes at cancel/submit, so billed time ≈
  recording time. New cost that didn't exist before: **cancelled
  recordings now bill** (streamed then discarded) — today they cost
  $0. At observed cancel rates this is noise.
- Free signup credits were discontinued Oct 2025; existing accounts
  keep theirs. Check the Soniox console for remaining credit.
- Sanity check: Deepgram streaming ~4x the price, AssemblyAI ~$0.15/hr
  with the same full-session billing. No reason to switch providers.
- Worst case guardrail: temp keys carry a server-enforced
  `max_session_duration_seconds` — a runaway open mic cannot bill past
  the cap. (A 300s client-side cap now exists — added 2026-08-24 with
  the batch-path timeout fixes, see
  `docs/features/transcription-timeouts-and-cap.md`.)

## Requirements

### Must have

- [ ] New edge function `transcription-token`: authenticated clients
      get a short-TTL Soniox temporary API key; audio streams
      **directly** from device to Soniox (edge function never touches
      audio bytes). Refuses when live transcription is disabled →
      that refusal *is* the kill switch.
- [ ] Client streams mic audio over WebSocket to
      `wss://stt-rt.soniox.com/transcribe-websocket` during recording,
      accumulating final tokens; on submit, end-of-stream → finalized
      transcript → existing `alignTranscription` → scoring, unchanged.
- [ ] Dual-path recording: the m4a file is still written. Any
      streaming failure (mint, connect, mid-stream, finalize) falls
      back to the existing batch `processRecording` with zero user
      action. Fallback must be silent (no error surfaced when batch
      succeeds).
- [ ] Stream teardown on **every** recording exit path: cancel button,
      scroll-away kill, screen unmount. No orphaned sockets (billed
      time).
- [ ] `durationMs` still captured from the recorder and still feeds
      `totalRecordingDurationMs` → `session_attempts` and the usage
      meter. Time-studied semantics unchanged.
- [ ] Verse text passed as Soniox `context` in the WS config message
      (parity with today's async `context.text` accuracy lever).
- [ ] Old clients unaffected: `process-recording` request/response
      contract frozen (multipart in; `{ transcription,
      cleanedTranscription, cleaningUsed }` out — `cleanedTranscription`
      must never be null). New function is purely additive.

### Nice to have

- [ ] Bump batch model `stt-async-v3` → `stt-async-v5` (v4 was retired
      June 2026 and aliased to v5; v3's status is unverified — it may
      already be aliased or may break one day). Small, self-contained,
      improves the fallback path's accuracy too.
- [ ] Close the session-loss window: since tap-done now completes in
      ~hundreds of ms, the unguarded background/back window shrinks to
      near zero *on the live path* — but an explicit fix (AppState
      listener / unmount save) is its own feature; see out of scope.
- [ ] Record at 16kHz mono for the streamed path (today's preset is
      44.1kHz stereo 128kbps — 4–8x more bytes than speech needs).

### Explicitly out of scope

- **Live display of the transcript while recording.** Confirmed not
  wanted — background only.
- Removing or rewriting the batch path. It is the permanent fallback.
- AppState/unmount session-save (the pre-existing loss window). Fix
  separately if wanted; this feature shrinks it incidentally.
- Provider switch (Deepgram/AssemblyAI). Priced; not worth it.
- Re-enabling quota enforcement (`checkTranscriptionUsage` exists,
  unused). Not this feature's job, noted for the security TODO.
- Android/web streaming parity beyond what the chosen audio library
  gives for free. iOS is the shipped platform.

## Product / tracking repercussions (verified against code)

The headline worry — "stats change if the wait disappears" — is
mostly **not mechanically true**:

- **Time studied is audio-seconds, not wall time.** It's the sum of
  recorder `durationMillis` across submitted recordings
  (`use-study-session.ts:180` → `session_attempts.recording_duration_ms`
  → `get_total_time_studied`). The transcription wait was never
  counted. Unchanged.
- **Cancel semantics unchanged.** A cancelled recording is a complete
  no-op for every persisted stat today and stays that way. "Streamed
  to Soniox" and "counts as anything" are fully decoupled: attempt
  rows, chunk completion, duration accumulation, and scoring all live
  behind `processRecording`, which a cancel never reaches — on the
  live path, cancel calls `abort()`, the socket closes, and the
  accumulated transcript is discarded from memory unscored, unstored,
  and undisplayed. Two real deltas vs today: (1) the cancelled
  seconds billed (~$0.001 per 30s cancel — see Cost model); (2) a
  privacy shift — today a cancelled recording's audio never leaves
  the device; with streaming, audio flows to Soniox from record-start,
  cancel or not. (Offsetting: Soniox real-time streams aren't stored
  as files, whereas the batch path uploads files to Soniox that are
  currently never deleted.) See Q8.
- **Attempt/streak semantics unchanged.** One `session_attempts` row
  per session, written at the same two call sites, same conditions.

What *does* shift, all second-order via "more sessions per sitting":

- More completed sessions → more attempt rows → time-studied totals
  and streak coverage rise (that's just more usage).
- Cheaper retries → more retry recordings → per-row
  `recording_duration_ms` inflates (retries already count toward time
  even though their scores are discarded — pre-existing behavior,
  amplified).
- `lifetimeReviews` inflates; engraved `passCount` does not (schedule-
  clamped to 1/day in `lib/store/review.ts`).
- The double-submission UI guard (`transcribing` disables the mic)
  narrows to the finalize window. The server-side
  `transcription_locks` mutex the docs mention **does not exist in
  code** (zero references; quota gate also removed) — so today's real
  guard is UI-only, and it stays UI-only. Acceptable: submit is
  disabled until the previous one resolves, same as today.
- Failed transcriptions inflate time studied (duration added *before*
  the API call). Pre-existing bug; the live path should add duration
  only after a transcript is obtained (either path) — see Technical
  Approach.

## Open Questions

### Q1: Audio capture library (the native change)

`expo-av` records to file only — no PCM chunk callback exists, so it
cannot feed a stream. Something native must change, which means a
store build (not OTA) and a dev build for testing (not Expo Go).

- **Option A: `@siteed/expo-audio-studio`** — the library Soniox's own
  RN docs name as the `AudioSource` example. Supports simultaneous
  file recording + PCM chunk emission (exactly the dual-path
  requirement). Third-party dependency; health/maintenance needs a
  check before committing. *(Best functional fit; adds a dep.)*
- **Option B: `expo-audio`** (Expo's expo-av successor) — first-party,
  and expo-av is deprecated-ish in newer SDKs so a migration is coming
  eventually anyway. Its PCM streaming support needs verification for
  SDK 54; may not do simultaneous file+chunks, which would force
  stream-only (weakens Q2 Option A fallback). *(Best long-term;
  functional fit unverified.)*
- **Option C: keep `expo-av` for the file, add a second capture path
  for PCM** — two recorders on one mic is generally not possible on
  iOS; almost certainly a dead end, listed for completeness.

A library-scout research pass on A vs B is cheap and should happen
before this is resolved.

### Q2: Fallback shape — dual-path or stream-only?

- **Option A: dual-path (file always written, stream best-effort)** —
  any stream failure falls back to today's exact batch flow with the
  file. No new failure modes visible to users; the feature can ship
  aggressively because failure = status quo. Costs: recording writes
  both a file and a stream (negligible battery/CPU at 23s avg
  sessions); requires the audio library to support it. *(Recommended
  by the research; assumed by this doc.)*
- **Option B: stream-only when live is enabled** — simpler capture
  layer, but a mid-stream socket drop **loses the user's audio**
  entirely; they'd have to re-recite. Given invariant 10 ("handle
  errors visibly"), this converts network blips into user-facing
  data loss. Hard to justify.

### Q3: Kill-switch mechanism

- **Option A: token-endpoint gate (server-side)** — `transcription-token`
  checks a flag; when disabled it returns
  `{ error: "LIVE_DISABLED" }`, clients silently fall back to batch.
  Flip = edge function env var/secret change or config row; takes
  effect for every client's next session, no deploy, no store review.
  *(Recommended: the fallback path doubles as the switch, so the
  switch is exercised on every failure and can't rot.)*
- **Option B: `app_config` table read by the client** — flag flips
  without even a token request. But adds a client read path, a caching
  question, and the client must still handle mint failure anyway — so
  A's machinery is required regardless. Only worth adding if we want
  to *save the token round-trip* when disabled (~one small request per
  session — irrelevant).
- **Option C: JS constant flipped via OTA** — the new release pipeline
  makes this minutes-fast for updated clients, but stale clients keep
  streaming until they update. Slower and leakier than A for no gain.

Sub-question: should the flag default **on** or **off** at first store
release? (Off = ship dark, flip on after on-device verification.)

### Q4: Usage metering for the live path

Today the edge function records `usage_daily.transcribe_seconds` after
each successful batch transcription. On the live path the server never
sees audio, so the meter goes blind unless we do something.

- **Option A: accept the gap** — `session_attempts.recording_duration_ms`
  already records the same quantity client-side, and Soniox's console
  is the billing truth. `usage_daily` is surfaced in zero UI and its
  quota check is disabled. *(Least code; the meter becomes
  batch-only.)*
- **Option B: client reports streamed seconds** to a small endpoint
  (or the token endpoint accepts a post-hoc report). Keeps the meter
  whole, but it's client-trusted data feeding an unused meter.
- **Option C: mint keys with `client_reference_id = user.id`** and
  treat Soniox's logs as the per-user record. Zero client code; data
  lives outside our DB. Can be combined with A.

Note: quota *enforcement* (if ever re-enabled) would need B — a
client-side gate can be bypassed, but so can client-reported
durations; real enforcement would need the token endpoint to cap via
`max_session_duration_seconds` per remaining quota. Flagged, not
designed here.

### Q5: Recording duration cap — **DECIDED 2026-08-24: 300s, auto-submit**

Caelan's call: flat **300s (5 min)** cap, no word-count-scaled
formula. Cap-hit behavior: the client ends the recording **as if the
user tapped done** — the recitation is transcribed and scored so the
user sees how far they got — plus a toast ("5 minute limit
reached"). Implemented client-side with the batch-path fixes
(`docs/features/transcription-timeouts-and-cap.md`), ahead of this
feature.

For the live path: mint temp keys with
`max_session_duration_seconds: 315` so the client's 300s timer
always fires first and the stream finalizes cleanly instead of
being killed mid-recitation by Soniox. If the server cap ever does
hit (client timer failed), it behaves like a socket drop → dual-path
batch fallback still scores the full file.

### Q6: Where finalize-wait UI lands

Tap-done on the live path still has a real (short) wait: empty frame →
final tokens → `finished: true`. Docs suggest ~200ms-order, unbounded
worst case.

- **Option A: keep the existing `transcribing` spinner state,
  timeboxed** — if finalize exceeds N seconds (e.g. 3s), abort the
  stream and fall back to batch (spinner continues, just longer).
  UI code barely changes; `RecordingBar`'s "Analyzing..." branch
  stays. *(Recommended; smallest diff.)*
- **Option B: new "finalizing" state with different copy/animation** —
  more honest, more code, and at sub-second durations the user never
  reads it.

### Q7: Scope of the housekeeping fixes — **RESOLVED 2026-08-24**

All three landed ahead of this feature in the batch-path timeout PR
(`docs/features/transcription-timeouts-and-cap.md`):

1. ~~`stt-async-v3` → `stt-async-v5` model bump~~ — done.
2. ~~Duration-counted-before-success bug~~ — done (accumulation
   moved after the transcript comes back).
3. ~~Stale `docs/architecture/edge-functions.md`~~ — corrected
   (locks/quota text removed; heartbeat streaming documented).

That PR also changed the batch response to a heartbeat stream
(200 committed early, whitespace every 10s, `{ error }` in-body for
late failures) — the fallback path this feature relies on no longer
dies to the client's ~60s socket idle timeout on long recordings.

Also noted, not proposed for this feature: `hooks/use-recording.ts` is
dead code (zero call sites; the live recorder is inlined in
`app/session.tsx`).

### Q8: Cancelled-recording privacy posture

Today, cancelling means the audio never left the device. With live
streaming, audio reaches Soniox from record-start regardless of how
the recording ends. Nothing is scored/stored/displayed from a cancel
(see Product repercussions), but the audio *was* transmitted.

- **Option A: accept as-is** — users of a recitation app know they're
  being transcribed; streaming-during-recording is the industry norm
  for voice features. Optionally add a line to the privacy policy.
  *(Recommended.)*
- **Option B: defer stream start** (e.g. don't open the socket until
  N seconds in, or until submit intent) — undermines the entire
  latency win; effectively rebuilds batch. Listed to be rejected
  deliberately.

## Technical Approach

*(Written assuming Q1=A-or-B with dual-path capture, Q2=A, Q3=A,
Q6=A. Revisit if answers differ.)*

### Data model changes

**None.** No new tables, columns, indexes, or RLS. The feature's
state is entirely ephemeral (per-recording) and its persistence
surface is unchanged (`session_attempts`, `user_verses`,
`usage_daily` all keep their exact current shapes and writers).

No sync impact (no synced tables touched). No Bible cache impact.

If Q3=B were chosen instead, one `app_config` row
(`key = 'live_transcription_enabled'`) — but note `app_config`
currently has **RLS disabled** (known security-todo item); piggy-
backing config reads on it is fine, writes must stay service-role.

### Edge function: `transcription-token` (new)

`supabase/functions/transcription-token/index.ts`, additive — old
clients never call it.

Request: `POST /functions/v1/transcription-token`
- Headers: `Authorization: Bearer <supabase JWT>` (verified in-code
  via `_shared/auth.ts verifyJwt`, same ES256 local check as
  `process-recording`)
- Body: none required.

Response 200:
```json
{
  "apiKey": "<temporary key>",
  "expiresAt": "2026-08-16T21:00:00Z",
  "websocketUrl": "wss://stt-rt.soniox.com/transcribe-websocket",
  "model": "stt-rt-v5"
}
```
Response 403 when disabled: `{ "error": "LIVE_DISABLED" }` — the
client treats *any* non-200 as "use batch."

Server logic:
1. `handleCors` / method gate / `verifyJwt` — copy the
   `process-recording` preamble.
2. Kill switch: `Deno.env.get("LIVE_TRANSCRIPTION_ENABLED") !== "true"`
   → 403 `LIVE_DISABLED`. (Flip via `supabase secrets set` — takes
   effect on next cold start, minutes.)
3. Mint: `POST https://api.soniox.com/v1/auth/temporary-api-key` with
   the server `SONIOX_API_KEY`, body:
   ```json
   {
     "usage_type": "transcribe_websocket",
     "expires_in_seconds": 60,
     "max_session_duration_seconds": 315,
     "client_reference_id": "<user.id>"
   }
   ```
   (60s TTL gates connection *establishment* only; the session may
   continue past it up to the duration cap. 315 per Q5: the client's
   300s cap timer fires first.)
4. Return key + static `websocketUrl`/`model` so the client hardcodes
   neither (server-side model bumps without client releases).

`supabase/config.toml`: add
```toml
[functions.transcription-token]
verify_jwt = false
```
(matches the existing per-function pattern — auth is in-code).

Backwards compat: `process-recording` is not modified (except the
optional Q7 model-string bump). Its frozen contract — multipart
`audio`/`durationMs`/`actualVerse` in, `{ transcription,
cleanedTranscription, cleaningUsed }` out, `cleanedTranscription`
never null — continues to serve old clients and the fallback path
indefinitely.

### Client: `lib/transcription/` (new module)

All network (token mint + WebSocket) lives here — never in the screen
or hook (invariant 1's spirit: screens call lib, lib talks to the
world).

```ts
// lib/transcription/live-session.ts
export type LiveSessionState = "connecting" | "streaming" | "failed";

export interface LiveTranscriptionSession {
  readonly state: LiveSessionState;
  feedAudio(chunk: Uint8Array): void;        // no-op if failed
  finish(timeoutMs: number): Promise<string>; // empty frame → finals → transcript
  abort(): void;                              // close socket, discard
}

// Returns null on any mint/connect failure — caller falls back to batch.
export async function startLiveTranscription(
  verseText: string
): Promise<LiveTranscriptionSession | null>;
```

Internals:
- Mint via `POST ${supabaseUrl}/functions/v1/transcription-token`
  (auth token from `lib/api/client.ts getAuthToken`), then open the
  WebSocket and send the config message:
  ```json
  {
    "api_key": "<temp key>",
    "model": "stt-rt-v5",
    "audio_format": "s16le",
    "sample_rate": 16000,
    "num_channels": 1,
    "language_hints": ["en"],
    "context": {
      "general": [
        { "key": "domain", "value": "Bible" },
        { "key": "topic", "value": "Bible verse memory recitation attempt" }
      ],
      "text": "<verseText>"
    }
  }
  ```
  (`audio_format` matches whatever PCM the chosen library emits —
  s16le/16k/mono is the target; parity with the batch path's context
  block preserves the accuracy lever, invariant "chunk.text is ground
  truth".)
- Accumulate tokens from responses: keep `is_final` tokens in an
  array; discard/replace non-finals (they're provisional). Transcript
  = concatenation of final-token `text` in order (Soniox tokens carry
  their own spacing/punctuation; strip the terminal `<fin>` marker).
- `finish()`: send empty binary frame → server finalizes → resolve on
  `finished: true` with the accumulated text; reject on timeout
  (caller falls back to batch).
- `abort()`: close the socket immediately (stops billing), discard
  state. Must be idempotent — it's called from multiple teardown
  paths.
- Any socket error / unexpected close → `state = "failed"`,
  `feedAudio` becomes a no-op; the session resolves to fallback at
  submit time. **No error UI** — failure here is invisible by design
  (Q2=A).
- Auth note: the API key rides in the first WS message, not a header
  — plain RN WebSocket works, no custom-header workarounds.

The transcript string is user-visible (rendered verbatim in
`ResultCard`), so no lossy normalization here — `align.ts` does its
own tokenize/normalize downstream, unchanged (invariant 6).

### Client: recording lifecycle (`app/session.tsx`)

The screen keeps hardware ownership. Changes:

- **Record start** (`handleMicPress`): after the recorder starts,
  `startLiveTranscription(chunks[currentIndex].text)` (fire-and-
  forget; if it resolves null, `liveSessionRef.current` stays null and
  this recording is batch-only). Wire the audio library's PCM chunk
  callback → `liveSessionRef.current?.feedAudio(chunk)`.
- **Cancel** (`handleCancel`), **scroll-away** (`onViewableItemsChanged`
  kill), **unmount cleanup**: add `liveSessionRef.current?.abort()`
  alongside the existing `stopAndUnloadAsync()`. Three teardown
  paths, all must close the socket.
- **Submit** (`handleSubmit`): capture `durationMs` and `uri` exactly
  as today, then pass the live session (if any) through to the hook:
  the hook's `processRecording(uri, durationMs)` gains an optional
  `liveSession` argument (or the screen resolves the transcript first
  and passes it — see State changes).
- `recordingState` stays a two-value type; stream health is *not* UI
  state (failure is invisible). No new gates. `transcribing` keeps its
  meaning: "waiting for a transcript after submit" — it's just short
  now on the live path (Q6=A).

### Client: `hooks/use-study-session.ts`

`processRecording` becomes provider-agnostic at its top:

```ts
// inside processRecording(uri, durationMs, liveSession?)
let transcript: string;
try {
  transcript = liveSession
    ? await liveSession.finish(FINALIZE_TIMEOUT_MS)
    : await batchTranscribe(uri, durationMs, actualText);
} catch {
  // live finalize failed → batch fallback with the file
  transcript = await batchTranscribe(uri, durationMs, actualText);
}
setTotalRecordingDurationMs(prev => prev + durationMs); // moved AFTER success (Q7.2)
```
where `batchTranscribe` is today's `processRecordingApi` call
unchanged. Everything downstream — `alignTranscription`,
`calculateChunkScore`, `chunkResults`, `updateVerseProgress`,
`logSessionAttempt`, retry/peek handling — is **untouched**. The
seam is exactly the existing single call site; scoring needs only a
whitespace-separated string, which both paths produce.

The duration accumulation moves below the transcript acquisition
(fixing the failed-transcription inflation, Q7.2). Retry and peek
taint reads stay where they are (peek is read at submit time inside
`processRecording`, so mid-recording reveals still zero the attempt —
unchanged either way).

### State changes

None in Zustand. New ephemeral state: one `liveSessionRef` (React
ref) in `app/session.tsx` next to `recordingRef` — hardware-adjacent,
per-recording lifetime, wiped on every teardown. The accumulated
partial transcript lives inside the `LiveTranscriptionSession` object
(the lib module), not in React state at all — nothing re-renders on
token arrival because nothing is displayed.

### UI

No new screens or components. `RecordingBar`'s "Analyzing..." branch
is retained for the finalize wait and the batch fallback (Q6=A). No
new icons.

### Edge cases

- **Offline at record start**: token mint fails → batch-only recording
  → submit fails with today's existing error alert. Net behavior
  identical to today (invariant 10 satisfied by inheritance).
- **Socket drops mid-recitation**: session flips to `failed`
  silently; file path scores the attempt. User sees today's spinner
  duration for that one submit.
- **Finalize hangs**: `finish()` rejects at `FINALIZE_TIMEOUT_MS`
  (~3s) → batch fallback → worst case is today's latency plus 3s,
  once, rarely.
- **Duration cap hit (Q5)**: Soniox ends the session server-side →
  same as socket drop → batch fallback scores the full file. No
  user-facing wall.
- **Cancel/scroll/unmount during streaming**: `abort()` closes the
  socket (stops billing); everything else identical to today's cancel
  no-op semantics.
- **Token expiry mid-recording**: non-issue — TTL gates connection
  establishment only.
- **Keepalive**: not needed — audio frames flow continuously for the
  socket's whole life; the socket never sits idle by design.
- **Double submit**: unchanged — mic is disabled while `transcribing`,
  and the live path narrows that window rather than removing it. (No
  server-side lock exists today; none is added.)
- **Old binary + flag on**: old builds lack the audio library and the
  new JS; they never call the token endpoint. New JS via OTA on an
  old binary must capability-check the native module before attempting
  the live path (fingerprint runtime policy should prevent this
  combination outright, but the check is one line — belt and
  suspenders).

### What does NOT change

- `process-recording` edge function contract (frozen for old clients;
  only the Q7 model string may change).
- `lib/align.ts`, `lib/study-chunks.ts`, all scoring math.
- `session_attempts` / `user_verses` / `usage_daily` schemas and all
  write sites; session/attempt/cancel/streak/mastery semantics.
- `updateVerseProgress` and the mastery/engraved logic.
- Zustand store shape.
- The batch path itself — it remains fully exercised as the fallback
  and for old clients, indefinitely.

## Build order

Each chunk leaves the app working; 1–3 are shippable dark.

1. **Housekeeping PR (pending Q7)**: `stt-async-v3` → `stt-async-v5`
   in `process-recording`; correct the stale sections of
   `docs/architecture/edge-functions.md` (locks/quota text). Files:
   `supabase/functions/process-recording/index.ts`,
   `docs/architecture/edge-functions.md`. No migration.
2. **Token endpoint**: `supabase/functions/transcription-token/index.ts`
   + `config.toml` block + `LIVE_TRANSCRIPTION_ENABLED` secret
   (default off). Verify with curl: 403 when off, valid key when on.
   No migration.
3. **`lib/transcription/live-session.ts`**: WS client, token
   accumulation, finish/abort. Verifiable in isolation (node script
   streaming a fixture wav against a minted key).
4. **Audio library swap (pending Q1)**: add the library, dev build,
   dual-path capture (file + PCM callback) wired in `app/session.tsx`
   behind the existing recording lifecycle. Native change — this is
   the store-build gate.
5. **Wire the seam**: `use-study-session.ts` transcript-acquisition
   block + duration-accumulation move (Q7.2); screen teardown paths.
   `npx tsc --noEmit`, `npm run lint`, on-device test of: live happy
   path, airplane-mode fallback, cancel teardown, kill switch flip.
6. **Docs pass**: update `docs/architecture/study-session.md` and
   `docs/architecture/edge-functions.md` (new function, new flow);
   this doc → `shipped`.

Release sequencing (interacts with the new EAS pipeline): steps 1–3
deploy immediately (edge functions) or ride any OTA. Step 4 is a
native change → fingerprint mismatch → full store build. Ship with
the flag off, flip `LIVE_TRANSCRIPTION_ENABLED` after on-device
verification against the store build (pending Q3 sub-question).

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-08-16 | Soniox stays the provider | Cheapest real-time of the three checked (~$0.12/hr); existing integration and context-priming carries over |
| 2026-08-16 | Direct device→Soniox streaming via temp keys, not proxying audio through an edge function | Soniox supports scoped temp keys (min TTL, session cap, per-user ref); proxying would add latency, edge-function wall-clock risk, and double bandwidth for zero security gain |
| 2026-08-16 | No live transcript display | Explicitly not wanted; background-only keeps UI and state changes near zero |
| 2026-08-24 | Q5: 300s flat cap, cap-hit = auto-submit-as-if-done + toast | Caelan's call; no word-count formula (real engineering vs ~$0.60 worst case). Server key cap 315s so the client timer fires first |
| 2026-08-24 | Q2 reaffirmed: dual-path, and no batch↔live mid-flight handoff | Handoff would add a stitching seam at the switchover for zero gain over "both run the whole time" |
| 2026-08-24 | Batch-path timeout fixes shipped first, separately | Fallback must be solid before live leans on it; see `transcription-timeouts-and-cap.md` |

## Graduation Checklist

- [ ] Session-loop changes reflected in `docs/architecture/study-session.md`
- [ ] Edge function changes reflected in `docs/architecture/edge-functions.md`
      (including correcting the pre-existing stale locks/quota text)
- [ ] CLAUDE.md invariants updated if the transcription seam becomes
      load-bearing (candidate: "all transcription goes through
      `lib/transcription/` / the `processRecording` seam")
- [ ] Schema changes: n/a (none)
- [ ] Sync/storage, auth, routing, UI-primitives, library, insights,
      home/VOTM, Bible cache: n/a (untouched)

## What Was Built

(Filled in when shipped.)
