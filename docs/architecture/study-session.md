# Study Session

> **Status: Living document.** Update when the session lifecycle,
> chunking, scoring, or mastery progression changes. Read before
> touching `app/session.tsx`, `hooks/use-study-session.ts`,
> `lib/study-chunks.ts`, `lib/align.ts`, or `components/study/`.

The study session is the core gameplay loop. The user picks verses
from a collection, picks a difficulty (Easy / Medium / Hard) and a
chunk size, then records themselves reciting the verse one chunk at
a time. The recording is transcribed by Soniox in an edge function;
alignment and scoring happen on the device.

## Where things live

| Layer | File | Role |
|---|---|---|
| Screen | `app/session.tsx` | UI, animations, recording lifecycle |
| Session state | `hooks/use-study-session.ts` | Per-session state machine, scoring orchestration |
| Pure logic | `lib/study-chunks.ts` | Chunking, difficulty masking |
| Pure logic | `lib/align.ts` | Token alignment between expected text and transcription |
| Edge function | `supabase/functions/process-recording/` | Audio → transcription (Soniox) |
| Persistence | `lib/api/analytics.ts` → `session_attempts` | One row per session completion |
| Mastery | `lib/store/index.ts` → `updateVerseProgress` | Difficulty progression + engraved tracking |

The split is intentional: the screen owns animations and recording
hardware, the hook owns session state, the libraries are pure and
deterministic, the edge function is stateless transcription.

## Lifecycle

### 1. Setup

Session entered via `/session?id=<verseId>&difficulty=<d>&chunkSize=<n>`.
On mount, `useStudySession` fetches the saved verse from the local
store via `getSavedVerses()`. If the verse doesn't have its keyed
text yet, it calls `getVerseText()` to fetch it through the Bible
API (which populates the session cache).

Once text is loaded:

```
parseVerseIntoChunks(savedVerse, difficulty, chunkSize, sessionSeed)
  → returns Chunk[] with stable IDs
  → each chunk has:
      id: stable string like "${verseId}:${startVerse}-${endVerse}"
      text: plain verse text — THE GROUND TRUTH FOR SCORING
      displayWords: [{ text, isBlank }, ...] — what the UI shows
```

### 2. Chunking

`lib/study-chunks.ts`. Deterministic, runs once per session.

- `chunkSize >= totalVerses` → one chunk for the whole verse range.
- Single-verse range → one chunk.
- Otherwise → group consecutive verses in groups of `chunkSize`.

Each chunk gets a stable ID (used as the FlatList key). The
`text` field is plain verse text without verse-number markers — it
is what scoring compares against.

### 3. Difficulty masking

`applyDifficulty(chunk, difficulty, seed)`:

- **Easy**: every word `isBlank: false`.
- **Hard**: every word `isBlank: true`.
- **Medium**: exactly 50% blanked, alternating. Whether the first
  word is blank depends on `seed % 2`.

The seed is `hashString(chunkId) + sessionSeed`, where `sessionSeed`
is `0` or `1` chosen randomly at session start
(`Math.floor(Math.random() * 2)`). This means:

- The mask for a given chunk is **stable for the whole session**.
- Re-entering the same verse in a new session may produce a
  different mask, so users can't memorize the blank pattern.

`displayWords` is built once and never re-computed on render.

### 4. Recording

`app/session.tsx` owns the recorder lifecycle via
`@siteed/audio-studio` (`useAudioRecorder`; pinned exactly to 3.2.0 —
3.2.1+ requires SDK 57 and breaks the SDK 54 Android build). One mic
session produces both an m4a file (batch fallback upload) and live
16kHz mono s16le PCM chunks (100ms cadence) that feed the background
live-transcription stream:

```
User taps mic
  → request permissions (AudioStudioModule)
  → liveSessionRef = startLiveTranscription(chunks[currentIndex].text)
      // lib/transcription/live-session.ts: mints a temp Soniox key via
      // the transcription-token edge function, opens the WebSocket,
      // buffers PCM fed before the socket is ready, flushes on open.
      // Any failure → state 'failed', silently; batch path takes over.
  → startRecording({ 16kHz mono pcm_16bit, compressed m4a output,
      onAudioStream → feedAudio(base64→bytes),
      onAudioAnalysis → waveform dB (50ms cadence) })
  → animate recording bar in
  → haptic Medium

User taps submit
  → clear the 5-minute cap timer
  → recording = stopRecording()
  → uri = recording.compression.compressedFileUri (m4a)
  → session.processRecording(uri, durationMs, liveSession)  // hook owns from here
  → animate recording bar out

Cancel / scroll-away / unmount
  → liveSession.abort()   // closes the socket (stops billing);
                          // recitation discarded — cancel is a no-op
  → stopRecording() discarded
```

Recordings are capped at 5 minutes (`MAX_RECORDING_MS` in
`app/session.tsx`): a timer started at record-start fires the same
submit handler as tap-done, plus a toast — the user still gets their
score for what they recited. The timer is cleared on submit, cancel,
scroll-away, and unmount, the same teardown paths as the recorder.
(Temp Soniox keys are minted with a 315s session cap so the client
timer always fires first; if Soniox ever cuts the stream, that's a
stream failure → batch fallback scores the full file.)

The screen owns the recorder, the live-session ref, the waveform
levels (a Reanimated shared value — bars are computed from the PCM
stream at 25ms RMS windows and animate entirely on the UI thread, so
recording causes zero React re-renders), and the recording-state
useState. The hook owns everything else. The screen also prewarms the
auth session on mount so the first mic press never pays a lazy token
refresh in front of the Soniox key mint. All live-transcription network I/O (token mint + WebSocket)
lives in `lib/transcription/live-session.ts`, never in the screen.

### 5. Scoring

In `processRecording()` on the hook:

```
1. actualText = chunks[currentIndex].text       // ground truth
2. transcript acquisition (provider-agnostic seam):
     liveSession present → cleanedTranscription = liveSession.finish(3s timeout)
       // waits a 50ms flush grace for trailing PCM (iOS emits the last
       // chunk before stopRecording resolves; Android's async post
       // needs the small hedge), sends end-of-audio, collects final
       // tokens — ~150ms total
     no liveSession, or finish() rejects for ANY reason
       → POST audio + actualText → process-recording edge function
       → { transcription, cleanedTranscription, cleaningUsed }
       // the fallback is silent: worst case is today's batch latency
3. alignment = alignTranscription(actualText, cleanedTranscription)
4. score = calculateChunkScore(alignment)        // (correct + close*0.5) / total * 100
5. chunkResults.set(currentIndex, { score, transcription, alignment })
6. completedChunks.add(currentIndex)
7. if all chunks completed:
     finalScore = calculateFinalScore(allAlignments)
     updateVerseProgress(verseId, difficulty, finalScore)   // → store
     logSessionAttempt({ ... })                              // → session_attempts
     showResults = true
```

Both transcript sources produce raw Soniox text (server-side LLM
cleaning is disabled), so scoring is path-independent — modulo small
model differences between `stt-rt-v5` (live) and `stt-async-v5`
(batch). Everything below step 2 is identical for both paths. There
is deliberately NO live/incremental scoring: alignment is local and
sub-millisecond, so the transcript is the only latency.

`alignTranscription` (`lib/align.ts`) tokenizes both strings —
splitting on whitespace and after em/en dashes, lowercasing, dropping
apostrophes and hyphens (possessive vs plural and hyphenation are
acoustically identical, so "eagle's" must match a transcribed
"eagles"), folding vocative "O" to "oh", stripping outer punctuation,
and dropping punctuation-only tokens. Transcript-side hesitation
fillers (um/uh/hmm — but NOT "ah" or "er", which occur in scripture)
are dropped. The guiding principle: never penalize a difference the
ASR cannot hear. It then
uses `diffArrays` over the normalized token arrays (so diff parts map
1:1 to tokens; string-based `diffWords` used to split inside words at
dashes/apostrophes and desync the token walk), with a substitution
post-pass that matches split/joined compounds by concatenation
("for ever" ↔ "forever" — 390 occurrences in KJV — "to morrow" ↔
"tomorrow", "forty-two" ↔ "forty two"), to produce
`AlignmentWord[]` with status `'correct' | 'close' | 'missing' |
'added'`. Currently `'close'` is never produced — the scoring formula
accounts for it (with a 0.5 weight) for future synonym support.

### 6. Score aggregation

| Scope | Where | When |
|---|---|---|
| Per chunk | `chunkResults: Map<number, ChunkResult>` | After each `processRecording` |
| Per session (final) | `calculateFinalScore(allAlignments)` | When every chunk has been recorded once |
| Per attempt (DB) | `session_attempts` row | At final-score time, or at early-exit if ≥1 chunk done |

The final score is what determines mastery — must be ≥90 to mark
the difficulty as completed for the verse. Per-chunk scores are
shown in the UI but don't propagate to the database directly.

### 7. Retry chunk

Added in commit `1288a52`. After a chunk completes, the user can
tap "retry" on its result card:

```
handleRetry(index)
  → adds index to exitingChunks (triggers exit animation)
  → onLayout-measured collapse animation runs
  → handleExitComplete(index)
      → session.retryChunk(index)
          → adds index to retryingChunks
  → mic button re-appears for that chunk
  → next recording for that chunk goes into retryResults[index],
    NOT chunkResults[index]
```

Critical: **retrying does not modify the original score**. The UI
shows a banner — "Retries don't affect your score." Final score uses
`chunkResults`, not `retryResults`.

### 7b. Peek / Reveal

Feature doc: `docs/features/peek-reveal.md`. An eye toggle in the
top-right of each `VerseCard` (hidden once the chunk completes):

- **Medium/Hard** — toggles the current chunk's hidden words visible
  (2x-speed stagger via `revealFast`) and back. The first reveal
  **taints** the chunk via `session.peekChunk(index)`: sticky and
  one-way, re-hiding never untaints. A tainted chunk's recorded
  attempt stores an **all-`missing` alignment**
  (`buildAllMissingAlignment` in `lib/align.ts`) in `chunkResults`,
  so it contributes 0 to the final score through the normal
  aggregator — no scorer special-casing. The real recited result is
  stashed in `peekResults` and shown on the result card with a
  "Revealed — this chunk won't count" banner (`ResultCard isPeeked`).
  Taint is evaluated at submit time, so revealing mid-recording still
  zeroes the in-flight attempt. Because the damage is word-pooled,
  peeking one chunk only zeroes that chunk's words — other chunks
  score normally.
- **Easy** — nothing is hidden, so the toggle is a self-testing aid
  with **no taint**: it cycles show → some → all → show. "some" masks
  ~50% via `maskDisplayWords` (`lib/study-chunks.ts`, cosmetic only);
  "all" renders Hard's recite-from-memory placeholder.

Visibility (`hideModes`, screen-local) is decoupled from taint
(`peekedChunks`, hook). **Completion wins over any hide override** —
a finished chunk always shows its text. Result card priority:
retry > peek > original.

### 8. End of session — mastery progression

When all chunks complete, `updateVerseProgress(verseId, difficulty,
finalScore, /* fullSession */ true)` runs in the Zustand store
(fire-and-forget — the results screen shows immediately; a failed
write surfaces as a toast, matching `saveAndExit`):

1. Update `progress[difficulty].bestAccuracy` and
   `progress[difficulty].completed = (finalScore >= 90)`.
2. If `difficulty === 'hard'` AND `finalScore >= 90` AND it was a
   full session, hand the current `engraved` sub-object to
   `computeNextSrState()` in `lib/store/review.ts`. That function
   advances the spaced-repetition schedule:
   - First-ever qualifying review → `passCount = 1`,
     `nextDueAt = now + 24h`.
   - On-time / overdue review → `passCount += 1`,
     `nextDueAt = now + min(passCount, userMaxInterval) * 24h`.
   - Early review (before `nextDueAt`) → `lifetimeReviews += 1`
     only; passCount and schedule untouched.
   - `passCount >= 10` flips `engraved.completed = true` (sticky).

The user-tunable `reviewMaxIntervalDays` (default 90, range 30–365)
caps how long the schedule can stretch.

A `session_attempts` row is logged via `logSessionAttempt()` —
fire-and-forget, no error toast on failure.

### Early exit

If the user closes mid-session with ≥1 chunk completed,
`saveAndExit()` runs:

- `calculatePartialScore()` treats every uncompleted chunk as
  fully missing words.
- That partial score is written to Zustand and DB as a normal
  attempt.
- Mastery progression does **not** update on partial sessions —
  only full completions count.
- The save is fire-and-forget: `router.back()` runs immediately and
  the Supabase write completes in the background. Awaiting it froze
  the X button for the full network round-trip. Failures are only
  console-logged (same as before — exit was never blocked on error).

> **Open question** for the human: 1 of 2 chunks done at 100% gives
> a partial score of ~50%. Is that the intended behavior, or should
> early exit only count completed chunks? Flag this when you have
> opinions; the current behavior is preserved for now.

## State

| State | Owner | Persisted? |
|---|---|---|
| `verse`, `chunks`, `currentIndex` | `useStudySession` (useState) | No — discarded on exit |
| `completedChunks: Set<number>` | hook | No |
| `chunkResults: Map<number, ChunkResult>` | hook | No |
| `retryingChunks: Set<number>` | hook | No |
| `retryResults: Map<number, ChunkResult>` | hook | No |
| `peekedChunks: Set<number>` (taint, one-way) | hook | No |
| `peekResults: Map<number, ChunkResult>` (display-only) | hook | No |
| `hideModes: Map<number, HideMode>` (visibility) | screen (useState) | No |
| `totalRecordingDurationMs` | hook | Persisted to DB at session end |
| `recordingState: 'idle' | 'recording'` | screen (useState) | No |
| `transcribing` | screen (useState) | No |
| `recordingRef`, `meteringRef`, `capTimerRef`, `waveformDataRef` | screen (useRef) | No |
| `progress`, `engraved` | Zustand store → Supabase | Yes |

The recording state lives on the screen because it's tightly coupled
to animations and the audio hardware. Everything else lives in the
hook.

## Edge function — `process-recording`

`supabase/functions/process-recording/index.ts`. **Transcribes only**
— does not score.

```
Receive: multipart form-data with audio blob, durationMs, actualVerse text
  → commit a 200 and stream a heartbeat space every 10s
    (keeps the client socket alive past its ~60s idle timeout)
  → upload audio to Soniox async API (stt-async-v5, actualVerse as context)
  → poll Soniox until transcription completes (1s interval, up to 90 polls)
  → optionally run cleaning pass via OpenAI GPT-5-mini (CLEANING_ENABLED = false right now)
Stream: { transcription, cleanedTranscription, cleaningUsed }
  (failures after the 200 is committed arrive as { error } in the body;
   the client checks the payload shape, not just response.ok)
```

Alignment and scoring happen on the device after this returns. The
GPT cleaning pass is dead code at the moment — flag is hardcoded to
false. Don't enable it without thinking through latency, cost, and
whether the prompt assumes recitation vs reading.

## Invariants

1. **Session state lives in `useStudySession`.** Don't duplicate
   per-session state in the screen or in Zustand. The screen owns
   recording hardware state only.
2. **`chunk.text` is the ground truth for scoring.** Always pass it
   to `alignTranscription`. Never use `displayWords`-derived text or
   the masked rendering.
3. **Chunk masks are computed once at session start.** Don't
   recompute `displayWords` on render — Medium would re-randomize
   every frame.
4. **Use `alignTranscription` for all comparisons.** Don't roll
   your own word matching. Tokenization and punctuation handling
   need to stay consistent.
5. **Retrying never modifies `chunkResults`.** Retry results go in
   `retryResults` and are display-only. Final score uses the
   original.
6. **Final score only computes once every chunk has at least one
   recording.** Don't update mastery before that.
7. **Mastery / engraved logic lives in the Zustand store
   (`updateVerseProgress`).** The hook calls this once at session
   end. Don't track streaks in the hook or in components.

## Sharp edges

- **Partial score on early exit treats incomplete chunks as fully
  missing.** See open question above.
- **`session_attempts` log is fire-and-forget.** Network failure =
  silently lost analytics. No retry, no toast. Worth fixing.
- **The metering loop (50ms) keeps running briefly after navigation
  if `recordingRef.current` is null** — harmless but produces
  console noise.
- **`isMeteringEnabled` may be false on the recording preset**
  (historical bug), making the waveform stay flat. If you see a
  flat waveform, check the recorder preset before chasing the
  metering code.
- **Old verses without `verses` keyed data** fall back to
  sentence/word-chunk splitting in `lib/study-chunks.ts`, which is
  unreliable. The hook tries to refetch keyed data first, so this
  is rare unless the network is flaky.
- **`isConsecutiveMonth` uses `"YYYY-MM"` string comparison** —
  timezone-safe, but DST and end-of-month edge cases could in
  theory miscount.
- **No double-submission guard.** UI disables the mic button while
  transcribing, but a slow edge function + double-tap could still
  submit twice. The latest result wins, but you might get a
  duplicate `session_attempts` row.
- **Soniox cleaning code path exists but is disabled.** If
  re-enabled without testing, transcription latency jumps 2–5
  seconds and the prompt may strip words incorrectly for read-back
  scenarios.
