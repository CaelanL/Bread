# Transcription

Turns a recitation into text for scoring. Every recording runs two paths at once:
a best-effort live stream to Soniox, and an m4a file on disk. Tapping done uses
the live transcript when it arrives and uploads the file when it doesn't. What
happens to the text afterward: `docs/features/study-session.md`. Server side of
both edge functions: `docs/architecture/edge-functions.md`.

## The rule

**All transcription flows through the `processRecording` seam in
`hooks/use-study-session.ts`. All live-streaming network I/O lives in
`lib/transcription/live-session.ts` (invariant 12).**

The live path uses a Soniox WebSocket, with short-TTL keys minted by the
`transcription-token` edge function. It fails silently into the batch path: no
live-path error reaches the reader, and the m4a file is always written, so a live
failure never loses a recording. The `LIVE_TRANSCRIPTION_ENABLED` secret is the
[kill switch](#kill-switch).

## Where things live

| Piece | File | Role |
|---|---|---|
| Recorder | `app/session.tsx`, `lib/transcription/recording-controls.ts` | Mic lifecycle, cap timer, waveform, live feed |
| Recording control | `components/study/RecordingBar.tsx` | Mic, startup ring, waveform and analysis indicator |
| Seam | `hooks/use-study-session.ts` (`processRecording`) | Picks the transcript, then aligns and scores |
| Live client | `lib/transcription/live-session.ts` | `startLiveTranscription`, `LiveTranscriptionSession` |
| Batch client | `lib/api/recording.ts` | `processRecording`: the upload to `process-recording` |
| Key mint | `supabase/functions/transcription-token/` | Temporary Soniox keys, and the kill switch |
| Batch transcribe | `supabase/functions/process-recording/` | Transcribes the file, never scores |

## Recording

`app/session.tsx` owns the recorder through `useAudioRecorder` from
`@siteed/audio-studio`, pinned to exactly `3.2.0`. One mic session produces both
outputs: an m4a file (`output.compressed`, with the WAV primary disabled), and 16
kHz mono 16-bit PCM chunks every 100 ms.

Tapping the mic in `handleMicPress`:

1. Claims one recording attempt for the current chunk and shows a loading ring
   around the mic circle. It asks for mic permission at once. The X beside the
   circle discards the attempt. Further mic taps are ignored while that attempt
   owns the recorder.
2. Calls `startLiveTranscription(chunk.text)`, which returns at once and connects
   in the background.
3. Calls `startRecording`. If the attempt was discarded during permission, it
   never starts. If discarded during native start, it stops as soon as start
   resolves and keeps ownership until that stop finishes.
4. Morphs the circle into a slimmer pill with the waveform, discard and submit
   actions, and arms the cap timer once native start resolves. The pill and its
   actions signal readiness even in silence. VoiceOver announces Listening.
   Motion, the connection to Soniox and the first PCM chunk do not gate capture
   or readiness. With Reduce Motion enabled, the ring is still and the control
   fades in place.

PCM goes two places:

- **Waveform:** `onAudioStream` calls `handleAudioStream`, which turns each chunk
  into four RMS levels in a Reanimated shared value. Recording causes no React
  re-renders, which is why the library's analysis events aren't used.
- **Live feed:** a screen-lifetime `LegacyEventEmitter` subscription to the
  module's `AudioData` event calls `feedAudio`. It bypasses `onAudioStream` because
  the hook nulls that callback when `stopRecording` resolves, and the trailing PCM
  chunk can reach JS after that.

The screen calls `getAuthToken` on mount, so the first mic press skips a token
refresh before the key mint.

### Submit and teardown

`handleSubmit` runs for the done button and the cap timer. The first call claims
the submit, stops the recorder and hands the file and live session to the seam.
The attempt keeps the live session through `processRecording` so the trailing
chunk can still reach it. While transcribing, the same pill shows a busy indicator.

Discarding, paging away, and leaving the screen cancel the attempt. The recorder
closes the live session and holds ownership until native cleanup finishes. A late
transcript from that attempt is ignored. Discarded recordings do not affect the
score, duration, or session attempt.

### Deleting recordings

The recorder writes `<UUID>.m4a` into Documents. `recording-controls.ts` deletes
each attempt's file (`fileUri` and `compressedFileUri`, deduplicated) through
`Capture.remove`: after a submit's processing settles (live, batch or failure,
and a cancel mid-processing waits for it), or after native stop for a discard.
Delete failures are ignored; cleanup never turns a score into an error.

`removeAbandonedRecordings` runs when the session screen mounts. It deletes
leftovers from crashes and old builds: Documents children named exactly
`<UUID>.m4a` and `Caches/AV` children named `recording-<UUID>.m4a` (old expo-av),
20 at a time. It stops while an attempt is unsettled; failures retry later.

## The `processRecording` seam

In `useStudySession`, `processRecording` uses `scoreRecording` in order:

1. `liveSession.finish(FINALIZE_TIMEOUT_MS)`. Any rejection becomes `null`.
2. `liveSession.abort()`, always. It's idempotent and guarantees the socket closes.
3. If there's no transcript and the attempt is still current, call
   `processRecording` from `lib/api/recording.ts` with the compressed file URI
   (or `fileUri`), duration and `chunk.text`.
4. Align and score the transcript. The hook applies the result and duration
   only if the attempt still owns the submission.

Both paths give raw Soniox text with the verse as recognition context. The models
differ (`stt-rt-v5` live, `stt-async-v5` batch), so a word can occasionally differ
between them. There is no second scoring path and no live transcript on screen.

## Live path

`startLiveTranscription(verseText, format)` returns a `LiveTranscriptionSession`
synchronously, so audio can be fed from the first callback. Its `state` runs
`connecting`, `streaming`, then `closed` or `failed`.

1. **Mint.** POST to `transcription-token` with the user's JWT. The response is
   `{ apiKey, expiresAt, websocketUrl, model }`.
2. **Buffer.** PCM captured while Soniox connects is held in memory. The mic
   can start as soon as native setup finishes, regardless of connection state.
3. **Open.** The first frame is JSON config: key, model, `pcm_s16le`, sample rate,
   channels, `language_hints`, and the verse as context. The backlog then flushes as
   individual chunks.
4. **Stream.** Tokens with `is_final` accumulate. `<fin>` and `<end>` are dropped.
5. **Finish.** `finish(timeoutMs)` waits `FLUSH_GRACE_MS` for the trailing chunk,
   sends an empty frame as end-of-audio, and resolves when Soniox says `finished`.
   If the socket is still connecting, the end frame goes out right after the flush.

Every failure goes through `fail()`, which logs `[LIVE] falling back to batch:
<reason>` with `console.log` (`console.warn` would raise a LogBox in dev), tears
down the socket and rejects any pending `finish`.

| Failure | Why it falls back |
|---|---|
| Token endpoint not 200, including 403 `LIVE_DISABLED` | No key |
| Mint throws (offline, no session) | No key |
| Socket error, or close while connecting or streaming | Stream is gone |
| Soniox `error_code` message | Stream is gone |
| Buffer passes `MAX_BUFFER_SECONDS` of audio | Connect stalled |
| `finish` called with no bytes ever fed | PCM capture is dead; empty text would score 0 |
| Transcript is empty or whitespace | Bad input route or near silence; the batch model tries the file |
| `FINALIZE_TIMEOUT_MS` passes | The file is more reliable than waiting |

After `failed` or `closed`, `feedAudio` is a no-op, because the batch path has the
file. `abort` is safe to call at any time.

## Batch path

`processRecording` in `lib/api/recording.ts` POSTs multipart form data to
`process-recording`: `audio` (the m4a), `durationMs`, `actualVerse`. It reads from
the URI, so the file is never loaded into JS memory.

The function commits a 200 once the request validates, streams one space every 10
seconds while Soniox works, then sends the JSON. `response.json()` tolerates the
leading whitespace. Failures after the 200 arrive as `{ error }` in the body, so the
client checks that `transcription` is a string rather than trusting `response.ok`.
The result is `{ transcription, cleanedTranscription, cleaningUsed }`. Cleaning is
off (`CLEANING_ENABLED = false`), so `cleanedTranscription` is the raw text.

Silent audio gives an empty transcript and a score of 0. Unlike live failures, batch
failures are shown: the error throws out of the seam, and `handleSubmit` shows the
"Recording failed" alert. The chunk stays incomplete, time studied doesn't grow, and
the reader records again.

## Timeouts and limits

| Limit | Value | Where | Purpose |
|---|---|---|---|
| Recording cap | 300 s | `MAX_RECORDING_MS` in `app/session.tsx` | Auto-submit |
| Live session cap | 315 s | `MAX_SESSION_SECONDS` in `transcription-token` | Client cap always fires first |
| Temporary key TTL | 60 s | `KEY_TTL_SECONDS` in `transcription-token` | Gates connecting only; a running stream outlives it |
| Connect buffer | 15 s of audio | `MAX_BUFFER_SECONDS` | Bounds a stalled connect |
| Flush grace | 50 ms | `FLUSH_GRACE_MS` | Lets the trailing PCM chunk feed |
| Finalize wait | 3 s | `FINALIZE_TIMEOUT_MS` in `score-recording.ts` | Then batch |
| Heartbeat | 10 s | `process-recording` | Beats the phone's roughly 60 s socket idle timeout |
| Soniox poll deadline | 90 s | `process-recording` | Bounds the batch wait |

The upload has no client timeout: the heartbeat removes the silent window and the poll
deadline bounds the work.

### The 5-minute cap

A timer armed at record start fires `handleSubmitRef.current()`, the same submit as
tapping done, plus the toast "5 minute limit reached — scoring what you recited." It
goes through a ref because the timer outlives the render it was armed in, and a stale
handler would miss retry and peek state set after recording began. The reader keeps
the recitation and gets a score, so a cap hit is not an error, though the toast
reuses `showErrorToast`. Leaving the recording phase clears the timer.

If Soniox ever cuts a stream at its own cap, that's a stream failure, and batch scores
the full file.

## Kill switch

`transcription-token` checks `LIVE_TRANSCRIPTION_ENABLED` after auth. Anything but
`true`, or unset, returns 403 `{ error: "LIVE_DISABLED" }`, which the client treats like any
other mint failure, so every client falls back to batch from its next recording. A secret change takes effect with no deploy or app update, and
in-flight streams finish normally. The batch path doesn't read the secret. Locally it
goes in `supabase/functions/.env`, then `db:stop` and `db:start`.

## Sharp edges

- **Audio leaves the device at record start.** The live stream runs from the first
  chunk, so a cancelled recording has already reached Soniox, though nothing from it
  is scored or stored.
- **Live usage isn't metered.** `recordTranscriptionUsage` runs only in
  `process-recording`, so `usage_daily.transcribe_seconds` is batch-only. Minted keys
  carry `client_reference_id: user.id` for attribution in Soniox. Any future quota
  has to account for this.
- **A failed upload isn't retried.** That attempt is lost ([Batch path](#batch-path)).
- **Trailing-chunk timing is load-bearing.** The live-feed subscription, keeping
  the attempt's live session through the seam, and `FLUSH_GRACE_MS` work together. Changing
  any of them can clip the last word, which raises `missing` with no error.
- **Naming.** Two functions are called `processRecording`, and `cleanedTranscription`
  holds raw text while cleaning is off.

## Browser checks

Recording needs a person and a real device. Local runs take the batch path unless the secret is set.

- With live on: Library, a verse, Start session, mic. Speak as soon as the waveform pill appears, then submit. Check the first word in the result and confirm the Metro log has no `[LIVE] falling back to batch` line.
- With the secret unset: same taps. The analysis indicator stays visible longer, the log says `falling back to batch: token endpoint 403`, the score still appears, and no error shows.
- Hold a recording past 5:00: the toast "5 minute limit reached — scoring what you recited." appears and a score follows, with no second submit.
- Mic, then the X beside the mic or on the pill: the pill collapses to the mic, there is no score, and no toast appears 5 minutes later.
- In Xcode's app container, `Documents` has no `<UUID>.m4a` after a live or batch score, a discard, or exit mid-analysis. Old ones go once a session opens.
- Reduce Motion on, relaunch Bread: the startup ring stays still and the control fades in place as capture starts.

**Can't start.** A start that throws (most often a call or app holding the mic; the error
doesn't say) shows "Couldn't start recording", asking to close it and retry. A denied
permission shows "Permission required".

## Decisions

- 2026-08-16 · Stream from the device to Soniox with temporary keys, not through an edge function · Scoped keys are enough for security. Proxying adds latency, wall-clock risk and bandwidth.
- 2026-08-16 · No live transcript on screen · Not wanted, and background-only keeps UI and state changes near zero.
- 2026-08-24 · Dual-path, with no mid-recording handoff between live and batch · The file always exists, and a handoff would add a stitching seam at the switch for no reliability gain.
- 2026-08-24 · Flat 300 s cap that auto-submits with a toast; keys capped at 315 s · The reader still sees how far they got, and the client timer fires first. A word-count formula wasn't worth building.
- 2026-08-24 · Heartbeat stream from `process-recording`, no client timeout · The phone killed silent sockets at about 60 s while the server finished fine. Leading whitespace keeps older clients parsing.
- 2026-08-24 · `@siteed/audio-studio` pinned to exactly `3.2.0` · It gives file and PCM from one mic session, which `expo-audio` can't on SDK 54. Later versions need SDK 57, so the pin and the SDK move together.
- 2026-08-24 · m4a-only recorder output · The file exists only for batch, whose contract expects m4a. WAV would just fill the cache.
- 2026-08-24 · Buffer and flush PCM during the live connection · Native capture can start independently of Soniox while the live path retains audio already captured.
- 2026-08-24 · No incremental scoring · Alignment is local and fast, so the transcript is the only wait. A second scoring path over provisional tokens would gain nothing.
- 2026-08-24 · `usage_daily` stays batch-only, with per-user attribution on minted keys · The meter is in no UI and its quota is off. Revisit if quota returns.
- 2026-09-02 · Feed live audio from a screen-lifetime subscription and keep the attempt's live session through the seam · The trailing PCM chunk can land after `stopRecording` resolves, which clipped the last word.
- 2026-11-12 · Delete each file once its attempt settles, sweep exact-name leftovers, no owned folder · Every take was kept forever. A folder adds a step before native start; the sweep covers it.
