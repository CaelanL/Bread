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
`transcription-token` edge function. It must fail silently into the batch path. It
never surfaces a live-path error to the reader, and a live failure never loses a
recording: the m4a file is always written, because the design is dual-path. The
`LIVE_TRANSCRIPTION_ENABLED` secret is the kill switch. Set it to anything but
`true`, or unset it, and every client falls back to batch from its next recording.

## Where things live

| Piece | File | Role |
|---|---|---|
| Recorder | `app/session.tsx` | Mic lifecycle, cap timer, waveform, live feed |
| Seam | `hooks/use-study-session.ts` (`processRecording`) | Picks the transcript, then aligns and scores |
| Live client | `lib/transcription/live-session.ts` | `startLiveTranscription`, `LiveTranscriptionSession` |
| Batch client | `lib/api/recording.ts` | `processRecording` upload to the edge function, same name as the seam |
| Key mint | `supabase/functions/transcription-token/` | Temporary Soniox keys, and the kill switch |
| Batch transcribe | `supabase/functions/process-recording/` | Transcribes the file, never scores |

## Recording

`app/session.tsx` owns the recorder through `useAudioRecorder` from
`@siteed/audio-studio`, pinned to exactly `3.2.0`. One mic session produces both
outputs: an m4a file (`output.compressed`, with the WAV primary disabled), and 16
kHz mono 16-bit PCM chunks every 100 ms.

Tapping the mic in `handleMicPress`:

1. Asks for mic permission.
2. Calls `startLiveTranscription(chunk.text)`, which returns at once and connects
   in the background.
3. Calls `startRecording`. If a teardown happened while the native start was in
   flight, `recordingGenRef` has moved on and the recorder stops right away.
4. Arms the cap timer and slides in `RecordingBar`.

PCM goes two places:

- **Waveform:** `onAudioStream` calls `handleAudioStream`, which turns each chunk
  into four RMS levels in a Reanimated shared value. Recording causes no React
  re-renders, which is why the library's analysis events aren't used.
- **Live feed:** a screen-lifetime `LegacyEventEmitter` subscription to the
  module's `AudioData` event calls `feedAudio`. It bypasses `onAudioStream` because
  the hook nulls that callback when `stopRecording` resolves, and the trailing PCM
  chunk can reach JS after that.

The screen also calls `getAuthToken` on mount, so the first mic press doesn't pay
for a token refresh in front of the key mint.

### Submit and teardown

`handleSubmit` runs for the done button and the cap timer. It stops the recorder,
takes `recording.compression?.compressedFileUri` (or `fileUri`), and hands the file
and live session to the seam. `liveSessionRef` stays set through
`processRecording`, so the trailing chunk still gets fed. Clearing it early clips
the last word. While transcribing, the bar shows a spinner and has no cancel.

`teardownRecording` handles every other exit: cancel, scroll-away, unmount, failed
start. It aborts the live session (closing the socket stops billing), invalidates
any in-flight start, clears the cap timer and stops the recorder. A cancelled
recording is discarded: no score, no duration, no attempt.

## The `processRecording` seam

In `useStudySession`, in order:

1. `liveSession.finish(FINALIZE_TIMEOUT_MS)`. Any rejection becomes `null`.
2. `liveSession.abort()`, always. It's idempotent and guarantees the socket closes.
3. If there's no transcript, call `processRecording` from `lib/api/recording.ts`
   with the file, duration and `chunk.text`.
4. Add the duration to time studied, only now that a transcript exists.
5. Align and score. This part doesn't know which path produced the text.

Both paths give raw Soniox text with the verse as recognition context. The models
differ (`stt-rt-v5` live, `stt-async-v5` batch), so a word can occasionally differ
between them. There is no second scoring path and no live transcript on screen.

## Live path

`startLiveTranscription(verseText, format)` returns a `LiveTranscriptionSession`
synchronously, so audio can be fed from the first callback. Its `state` runs
`connecting`, `streaming`, then `closed` or `failed`.

1. **Mint.** POST to `transcription-token` with the user's JWT. The response is
   `{ apiKey, expiresAt, websocketUrl, model }`.
2. **Buffer.** PCM fed while connecting is held in memory, so the first words
   survive the connect gap. Recording starts instantly, with no connecting state in
   the UI.
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
| Finalize wait | 3 s | `FINALIZE_TIMEOUT_MS` in the hook | Then batch |
| Heartbeat | 10 s | `process-recording` | Beats the phone's roughly 60 s socket idle timeout |
| Soniox poll deadline | 90 s | `process-recording` | Bounds the batch wait |

The client sets no timeout or `AbortController` on the upload. The heartbeat removes
the silent window and the poll deadline bounds the work.

### The 5-minute cap

A timer armed at record start fires `handleSubmitRef.current()`, the same submit as
tapping done, plus the toast "5 minute limit reached — scoring what you recited." It
goes through a ref because the timer outlives the render it was armed in, and a stale
handler would miss retry and peek state set after recording began. The reader keeps
the recitation and gets a score, so a cap hit is not an error, though the toast
reuses `showErrorToast`. Every teardown and submit clears the timer.

If Soniox ever cuts a stream at its own cap, that's a stream failure, and batch scores
the full file.

## Kill switch

`transcription-token` checks `LIVE_TRANSCRIPTION_ENABLED` after auth. Anything but
`true` returns 403 `{ error: "LIVE_DISABLED" }`, which the client treats like any
other mint failure. A secret change takes effect with no deploy or app update, and
in-flight streams finish normally. The batch path doesn't read the secret. A local
run takes the batch path until the secret is set for local functions.

## Sharp edges

- **Audio leaves the device at record start.** The live stream runs from the first
  chunk, so a cancelled recording has already reached Soniox, though nothing from it
  is scored or stored.
- **Live usage isn't metered.** `recordTranscriptionUsage` runs only in
  `process-recording`, so `usage_daily.transcribe_seconds` is batch-only. Minted keys
  carry `client_reference_id: user.id` for attribution in Soniox. Any future quota
  has to account for this.
- **A failed upload isn't retried.** Live failures are silent, but a batch failure
  loses that attempt. The reader sees the alert and recites again.
- **A second submit tap downgrades to batch.** `recordingActiveRef` stops a double
  submit from scoring twice, but the early return aborts the live session. The first
  submit's `finish` then rejects and the file is uploaded. Slower, nothing lost.
- **The mic stays tappable during native start.** `recordingState` flips only after
  `startRecording` resolves, so a quick second press starts a second session and
  aborts the first live stream.
- **Trailing-chunk timing is load-bearing.** The live-feed subscription, keeping
  `liveSessionRef` set through the seam, and `FLUSH_GRACE_MS` work together. Changing
  any of them can clip the last word, which raises `missing` with no error.
- **Naming.** Two functions are called `processRecording`, and `cleanedTranscription`
  holds raw text while cleaning is off.

## Browser checks

Recording needs a person and a real device. Local runs take the batch path unless the secret is set.

- With live on: Library, a verse, Start session, mic, recite, check. The score appears almost at once, and the Metro log has no `[LIVE] falling back to batch` line.
- With the secret unset: same taps. The "Analyzing your recitation..." spinner runs longer, the log says `falling back to batch: token endpoint 403`, the score still appears, and no error shows.
- Hold a recording past 5:00: the toast "5 minute limit reached — scoring what you recited." appears and a score follows, with no second submit.
- Mic, then the X on the red bar: the bar slides away, the mic returns, there is no score, and no toast appears 5 minutes later.

## Decisions

- 2026-08-16 · Stream from the device to Soniox with temporary keys, not through an edge function · Scoped keys are enough for security. Proxying adds latency, wall-clock risk and bandwidth.
- 2026-08-16 · No live transcript on screen · Not wanted, and background-only keeps UI and state changes near zero.
- 2026-08-24 · Dual-path, with no mid-recording handoff between live and batch · The file always exists, and a handoff would add a stitching seam at the switch for no reliability gain.
- 2026-08-24 · Flat 300 s cap that auto-submits with a toast; keys capped at 315 s · The reader still sees how far they got, and the client timer fires first. A word-count formula wasn't worth building.
- 2026-08-24 · Heartbeat stream from `process-recording`, no client timeout · The phone killed silent sockets at about 60 s while the server finished fine. Leading whitespace keeps older clients parsing.
- 2026-08-24 · `@siteed/audio-studio` pinned to exactly `3.2.0` · It gives file and PCM from one mic session, which `expo-audio` can't on SDK 54. Later versions need SDK 57, so the pin and the SDK move together.
- 2026-08-24 · m4a-only recorder output · The file exists only for batch, whose contract expects m4a. WAV would just fill the cache.
- 2026-08-24 · Connect gap solved by buffer-and-flush, not a connecting state · Recording starts instantly and first words survive.
- 2026-08-24 · No incremental scoring · Alignment is local and fast, so the transcript is the only wait. A second scoring path over provisional tokens would gain nothing.
- 2026-08-24 · `usage_daily` stays batch-only, with per-user attribution on minted keys · The meter is in no UI and its quota is off. Revisit if quota returns.
- 2026-09-02 · Feed live audio from a screen-lifetime subscription and keep `liveSessionRef` through the seam · The trailing PCM chunk can land after `stopRecording` resolves, which clipped the last word.
