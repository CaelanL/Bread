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

The live path uses a Soniox WebSocket, with short-TTL keys from the
`transcription-token` edge function. It fails silently into batch: no live error
reaches the reader, and the m4a is always written, so no recording is lost. The `LIVE_TRANSCRIPTION_ENABLED` secret is the
[kill switch](#kill-switch).

## Where things live

| Piece | File | Role |
|---|---|---|
| Recorder | `app/session.tsx`, `lib/transcription/recording-controls.ts` | Mic, cap timer, waveform, live feed |
| Recording control | `components/study/RecordingBar.tsx` | Mic, ring, waveform, analysis indicator |
| Seam | `hooks/use-study-session.ts` (`processRecording`) | Picks the transcript, then aligns and scores |
| Live client | `lib/transcription/live-session.ts` | `LiveStandby`, `startLiveTranscription` |
| Batch client | `lib/api/recording.ts` | `processRecording`: the upload to `process-recording` |
| Key mint | `supabase/functions/transcription-token/` | Temporary Soniox keys, and the kill switch |
| Batch transcribe | `supabase/functions/process-recording/` | Transcribes the file, never scores |

## Recording

`app/session.tsx` calls `AudioStudioModule` from `@siteed/audio-studio` (pinned
to `3.2.0`) directly, not its recorder hook, which re-renders the screen on start,
stop and every second. One mic session gives a 64 kbps AAC m4a
(`output.compressed`, no WAV) and 16 kHz mono 16-bit PCM in 50 ms pieces.

The mic and Retry start on finger-down (`onPressIn`), with no slide-off cancel.
`onPress` covers activations without a press-in; the press ending a touch that
already pressed in is ignored (`source` in `start`), so a fast denial alerts once.
Permission is read at screen open and after any prompt. Then `handleMicPress`:

1. Claims one attempt for the chunk; further taps are ignored while it owns the
   recorder.
2. If permission is granted, calls `startRecording` and opens live in the touch's
   own tick, before the loading ring renders. Otherwise the ring shows during the
   prompt, then live opens and recording starts. The iOS haptic follows.
3. The X beside the ring discards. Discarded during permission, it never starts;
   during native start, it stops once start resolves, holding ownership until then.
4. Once native start resolves, morphs into the pill (waveform, discard, submit) and
   arms the cap timer. VoiceOver says Listening. Soniox and the first PCM chunk
   never gate capture. Reduce Motion keeps the ring still and fades.

A screen-lifetime `LegacyEventEmitter` subscription to the module's `AudioData`
event decodes each piece once: two RMS bars into a Reanimated shared value (no
React re-render), then `feedAudio`. It outlives `stopRecording`, because the
trailing piece can reach JS after stop resolves.

### Submit and teardown

`handleSubmit` runs for the done button and the cap timer. The first call claims
the submit, stops the recorder and hands the file and live session to the seam.
The attempt keeps the live session through `processRecording` so the trailing
chunk can still reach it. While transcribing, the same pill shows a busy indicator.

Discarding, paging away, and leaving cancel the attempt: the live session closes,
ownership holds until native cleanup ends, a late transcript is ignored, and
score, duration and session attempt are untouched.

### Deleting recordings

The recorder writes `<UUID>.m4a` into Documents. `recording-controls.ts` deletes
each attempt's files (`fileUri`, `compressedFileUri`) through `Capture.remove`
once a submit's processing settles (a cancel mid-processing waits for it), or
after native stop for a discard. Delete failures are ignored.

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

`startLiveTranscription(verseText, standby)` returns a `LiveTranscriptionSession`
synchronously, so audio can be fed from the first callback. Its `state` runs
`connecting`, `streaming`, then `closed` or `failed`.

1. **Standby.** The screen's `LiveStandby` mints a key on mount (one mint at a
   time), reused 270 s from arrival (not `expiresAt`: clock skew), and opens a
   spare socket with it, kept alive every 10 s. A tap takes the spare unless its
   key is stale. Soniox checks the key at config, so the spare is replaced before
   then. One recording per socket; the next spare opens as a session ends. Closed
   in the background and on leaving; a dropped spare reopens once; no spare after
   a failed mint. A failure before Soniox's first good message drops the key.
2. **Buffer.** PCM captured while Soniox connects is held in memory, so capture
   never waits on the connection.
3. **Open.** The key goes in the protocols list (`['soniox-api-key', key]`). The
   first frame is JSON config: model, `pcm_s16le`, sample rate, channels,
   `language_hints`, and the verse as context. The backlog then flushes as chunks.
4. **Stream.** Tokens with `is_final` accumulate. `<fin>` and `<end>` are dropped.
5. **Finish.** A socket still connecting fails at once (`never opened`). Otherwise
   `finish(timeoutMs)` waits `FLUSH_GRACE_MS` for the trailing piece, sends an empty
   end-of-audio frame, and resolves when Soniox says `finished`.

Every failure goes through `fail()`: it logs `[LIVE] falling back to batch:
<reason>` (`console.log`, since `console.warn` raises a LogBox), tears down the
socket and rejects any pending `finish`.

| Failure | Why it falls back |
|---|---|
| Token endpoint not 200, including 403 `LIVE_DISABLED` | No key |
| Mint throws (offline, no session) | No key |
| Socket error, or close while connecting or streaming | Stream is gone |
| Soniox `error_code` message | Stream is gone |
| Buffer passes `MAX_BUFFER_SECONDS` of audio | Connect stalled |
| Socket still connecting at `finish` | Batch has the file; no wait |
| No bytes fed by the end of the grace | PCM capture is dead; empty text would score 0 |
| Transcript is empty or whitespace | Bad input route or near silence; the batch model tries the file |
| `FINALIZE_TIMEOUT_MS` passes | The file is more reliable than waiting |

After `failed` or `closed`, `feedAudio` is a no-op. `abort` is always safe.

## Batch path

`processRecording` in `lib/api/recording.ts` POSTs multipart form data to
`process-recording`: `audio` (the m4a), `durationMs`, `actualVerse`. It reads from
the URI, so the file is never loaded into JS memory.

The function streams heartbeat spaces before its JSON, and failures after its 200
arrive as `{ error }` (`docs/architecture/edge-functions.md`), so the client checks
that `transcription` is a string rather than trusting `response.ok`. Cleaning is
off, so `cleanedTranscription` is the raw text.

Silent audio gives an empty transcript and a score of 0. Unlike live failures, batch
failures are shown: the error throws out of the seam, and `handleSubmit` shows the
"Recording failed" alert. The chunk stays incomplete, time studied doesn't grow, and
the reader records again.

## Timeouts and limits

| Limit | Value | Where | Purpose |
|---|---|---|---|
| Recording cap | 300 s | `MAX_RECORDING_MS` in `app/session.tsx` | Auto-submit |
| Live session cap | 315 s | `MAX_SESSION_SECONDS` in `transcription-token` | Client cap always fires first |
| Temporary key TTL | 300 s | `KEY_TTL_SECONDS` in `transcription-token` | Checked when config is sent; a running stream outlives it |
| Key reuse | 270 s | `KEY_REUSE_MS` in `live-session.ts` | TTL less 30 s |
| Connect buffer | 15 s of audio | `MAX_BUFFER_SECONDS` | Bounds a stalled connect |
| Flush grace | 50 ms | `FLUSH_GRACE_MS` | Lets the trailing PCM chunk feed |
| Finalize wait | 1.5 s | `FINALIZE_TIMEOUT_MS` in `score-recording.ts` | Then batch |
| Batch file | 64 kbps AAC | `handleMicPress` | Lower risks a rejected encoder and no m4a |
| Heartbeat | 10 s | `process-recording` | Beats the phone's ~60 s socket idle timeout |
| Soniox poll deadline | 90 s | `process-recording` | Bounds the batch wait |

The upload has no client timeout: the heartbeat removes the silent window and the poll
deadline bounds the work.

### The 5-minute cap

A timer armed at record start fires `handleSubmitRef.current()`, the same submit as
done, plus the toast "5 minute limit reached — scoring what you recited." The ref
keeps a stale handler from missing retry and peek state set after recording began.
A cap hit isn't an error, though the toast reuses `showErrorToast`. Leaving the
recording phase clears the timer.

If Soniox ever cuts a stream at its own cap, that's a stream failure, and batch scores
the full file.

## Kill switch

`transcription-token` checks `LIVE_TRANSCRIPTION_ENABLED` after auth. Anything but
`true` returns 403 `LIVE_DISABLED`, a mint failure, so clients fall back to batch
from their next mint (an open study screen keeps its key up to 270 s). No deploy
needed; in-flight streams finish; batch ignores it. Locally: `supabase/functions/.env`,
then `db:stop` and `db:start`.

## Sharp edges

- **Audio leaves the device at record start.** The live stream runs from the first
  chunk, so a cancelled recording has already reached Soniox, though nothing from it
  is scored or stored.
- **Live usage isn't metered.** `usage_daily.transcribe_seconds` is batch-only
  (`recordTranscriptionUsage` in `process-recording`). Keys carry
  `client_reference_id: user.id` for Soniox attribution. A future quota must count live.
- **A failed upload isn't retried.** That attempt is lost ([Batch path](#batch-path)).
- **Trailing-chunk timing is load-bearing.** The live-feed subscription, keeping
  the attempt's live session through the seam, and `FLUSH_GRACE_MS` work together. Changing
  any of them can clip the last word, which raises `missing` with no error.
- **Naming.** Two functions are called `processRecording`; `cleanedTranscription`
  is raw text.

## Browser checks

Recording needs a person and a real device. Local runs use batch unless the secret is set.

- With live on: Start session, mic, speak as the pill appears, submit, then Retry. The first word scores, and Metro has no `[LIVE] falling back` line for either take (a silent take's `empty transcript` still means Soniox accepted the key).
- With the secret unset: the log says `mint failed: token endpoint 403`, and the score still appears with no error.
- Dev builds log `[MIC] down→call →resolve →first audio · N renders` at stop. VoiceOver double-tap records once.
- Hold a recording past 5:00: the toast "5 minute limit reached — scoring what you recited." appears and a score follows, with no second submit.
- Mic, then the X beside the mic or on the pill: the pill collapses to the mic, there is no score, and no toast appears 5 minutes later.
- In Xcode's app container, `Documents` has no `<UUID>.m4a` after a live or batch score, a discard, or exit mid-analysis. Old ones go once a session opens.
- Reduce Motion on, relaunch Bread: the startup ring stays still and the control fades in place as capture starts.

**Can't start.** A throwing start (usually a call or app holding the mic) shows
"Couldn't start recording". A denied permission shows "Permission required".

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
- 2026-11-14 · Finger-down start, native start before the ring, one key per screen (300 s TTL, protocol auth), 1.5 s finalize, 64 kbps, 50 ms pieces, no recorder hook · Faster capture, fallback and upload. Soniox refuses `api_key` in the config from 15 January 2027.
- 2026-11-14 · Spare socket from screen open, config only at the tap · Tested: Soniox bills and caps sessions from config; a pause after config is billed.
