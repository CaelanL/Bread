# Feature: Transcription timeout fix + 5-minute recording cap

> **Status:** `building`
> **Created:** 2026-08-24
> **Related:** `docs/features/live-transcription.md` — this PR hardens
> the batch path that live transcription will later use as its
> permanent fallback. Ships first, independently.

## Caelan's asks

- Fix the bug: long recordings make the transcription request die
  with a network error.
- Add a 300-second (5 min) recording cap. When it hits, end the
  recording **exactly as if the user tapped done** — transcribe and
  score what they recited so they can see how far they got — and
  show a toast saying the 5-minute limit was exceeded.

## What this PR is NOT (decided 2026-08-24)

- **Not the live/streaming transcription feature.** That's a
  separate later build (needs a native audio library → store build).
  Its doc: `docs/features/live-transcription.md`.
- **No stream-only mode and no batch↔live "switch in between"
  handoff.** When live ships it will be **dual-path**: the m4a file
  is always recorded like today, streaming runs alongside as
  best-effort, and any stream failure silently falls back to
  uploading the file — the exact path this PR hardens. A mid-flight
  handoff would add a stitching seam (duplicate/missing words at the
  boundary) for zero reliability gain over dual-path. Rejected.
- **No word-count-scaled cap formula.** Flat 300s. Longest recording
  ever observed is 277s; a formula is real engineering protecting
  against a ~$0.60 worst case.

## The bug (diagnosed 2026-08-24, code + prod logs)

- Client submits with a bare `fetch` — zero timeouts configured
  anywhere in the app.
- The edge function uploads to Soniox, then polls at 1s intervals
  (up to ~60–70s) while sending **zero response bytes**.
- iOS kills a socket after ~60s of silence → phone shows
  `Network request failed` while the server finishes cleanly and
  logs success. Prod logs confirm: all recent requests are fast
  200s; the failures never appear server-side because they happen
  on the phone.

## The fixes

- **Heartbeat streaming response** (`process-recording`): respond
  200 as soon as the request is validated, stream one space every
  10s while Soniox works, then the JSON. Silent window drops from
  "entire transcription" to ≤10s. Leading whitespace is valid JSON
  → old clients' `response.json()` parses unchanged.
- **300s cap** (`app/session.tsx`): client-side timer started at
  record-start; at 5:00 it calls the same submit handler as
  tap-done + `showErrorToast('5 minute limit reached — scoring what
  you recited.')`. Cleared on cancel / submit / scroll-away /
  unmount.
- **Time-studied fix** (`hooks/use-study-session.ts`): duration now
  counted only *after* a transcript comes back — failed
  transcriptions no longer inflate stats.
- **Drop the audio double-read** (`lib/api/recording.ts`): no more
  loading the whole file into JS memory before upload.
- **Server hygiene**: Soniox model `stt-async-v3` → `stt-async-v5`
  (v4 already retired); poll budget 60 → 90 attempts; fixed
  off-by-one where completion on the final poll was reported as a
  timeout.

## Product decisions

- Cap-hit is **not an error** — user keeps their recitation, sees
  their score, gets a toast. The cap is invisible punishment-wise.
- Toast reuses the existing `showErrorToast` (red) — acceptable for
  now; a neutral toast variant wasn't worth new UI.
- Error alert copy unchanged (still the raw
  `Recording failed: ...`) — follow-up if it keeps being annoying.
- No client-side AbortController: every path is now bounded
  (heartbeat removes the silent window, server poll cap bounds
  duration, OS idle timer catches dead networks).

## Edge cases to make sure of

- **Old clients (current App Store build) against the new
  function**: heartbeat whitespace + JSON must parse via their
  `response.json()`. Verified by design (leading whitespace is
  legal JSON) — confirm with curl after deploy.
- **Late server failure** (after streaming starts, e.g. Soniox poll
  exhausted): arrives as `200 + {"error"}`. New client detects the
  shape and throws "Processing failed"; old clients fall into their
  existing generic error alert.
- **Cap timer never fires as a ghost**: cleared on cancel,
  scroll-away, unmount, and at the top of submit (manual submit
  wins the race).
- **Cap fires while offline**: auto-submit fails with the same
  error alert as a manual offline submit; time-studied must not
  grow.
- **Empty/instant recordings**: the client-side empty-file check
  was removed; a 0-byte file now surfaces as the generic server
  error. Rare and acceptable.
- **Double-submit**: unchanged — mic stays disabled while
  `transcribing`; no server-side lock exists (and never did,
  despite what old docs said).

## Test checklist (device, after edge function deploy)

1. **Short recording happy path** — record ~20s, submit, score
   appears, transcript looks right (also validates the v5 model).
2. **Long recording** — recite something 2–3 min long. Previously
   this timed out; it should now succeed (expect a longer spinner).
3. **Cap** — leave a recording running past 5:00 (or temporarily
   lower `MAX_RECORDING_MS` to ~15s for the test): auto-submits,
   toast shows, score appears, timer doesn't fire again.
4. **Teardowns** — cancel mid-recording, scroll away mid-recording,
   exit the screen mid-recording: no toast later, no crash, no
   ghost submit.
5. **Offline** — airplane mode, record, submit: error alert shows;
   insights time-studied does not grow; recording again after
   reconnect works.
6. **Old-client contract** — curl the deployed function with a real
   m4a and confirm: heartbeat spaces arrive progressively, final
   body parses as JSON (`curl -N ... | cat -A` shows the spaces).
7. **Retry/peek flows** — one retry and one peek still behave
   normally (duration-accumulation move touched that code path).

## Carries into live-transcription (when that feature is built)

- Q5 answered: minted temp keys get
  `max_session_duration_seconds: 315` — client timer fires at 300s
  first, leaving margin to finalize cleanly instead of being killed
  mid-stream by Soniox.
- Cap semantics identical on the live path: cap hit = `finish()`
  (submit-as-if-done + toast), never a hard kill.
- Q2 answered: dual-path fallback (file always written), no
  stream-only, no handoff.

## Deploy + curl verification (done 2026-08-24)

The edge function (v59) is **already deployed to prod** — it's
backwards compatible with the shipped App Store client, verified
live:

- **Heartbeat proven on the real path**: a 15-minute test file made
  Soniox take ~22s; two 1-byte heartbeats arrived at exactly 10s
  intervals, then the 31KB payload. The `stream-test` scratch
  function separately proved the gateway never buffers 1-byte
  chunks (4 chunks at exact 5s intervals). No client can see >10s
  of wire silence anymore.
- **Old-client parse**: bodies arrive as leading spaces + JSON;
  `json.loads`/`response.json()` parses them unchanged (verified on
  7s, 3.7min, and 15min files; transcripts fully correct on
  `stt-async-v5` — 756/756 and 3024 words).
- **Late-error shape**: garbage audio → `200 + {"error":"Processing
  failed"}` as designed. Old clients throw into their existing
  generic alert before recording anything (code-review traced).
- **Pre-stream errors**: missing auth still returns a real 401.
- Test account and its usage rows deleted; `stream-test` function
  stubbed to an authed 410 — safe to delete from the dashboard.

Remaining before shipping the client: the on-device checklist above
(items 1–5, 7) on Caelan's phone.

## What Was Built

(Filled in when shipped.)
