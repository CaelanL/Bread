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

`app/session.tsx` owns `expo-av` lifecycle:

```
User taps mic
  → request permissions
  → Audio.Recording.createAsync(...)
  → start metering loop (50ms tick, normalized 0–1, pushed to waveformDataRef)
  → animate recording bar in
  → haptic Medium

User taps submit
  → stop metering loop
  → recording.stopAndUnloadAsync()
  → uri = recording.getURI()
  → session.processRecording(uri, durationMs)   // hook owns from here
  → animate recording bar out
```

The screen owns the recorder, the metering ref, the waveform data
ref, and the recording-state useState. The hook owns everything
else.

### 5. Scoring

In `processRecording()` on the hook:

```
1. actualText = chunks[currentIndex].text       // ground truth
2. POST audio + actualText → process-recording edge function
3. response = { transcription, cleanedTranscription, cleaningUsed }
4. alignment = alignTranscription(actualText, cleanedTranscription)
5. score = calculateChunkScore(alignment)        // (correct + close*0.5) / total * 100
6. chunkResults.set(currentIndex, { score, transcription, alignment })
7. completedChunks.add(currentIndex)
8. if all chunks completed:
     finalScore = calculateFinalScore(allAlignments)
     updateVerseProgress(verseId, difficulty, finalScore)   // → store
     logSessionAttempt({ ... })                              // → session_attempts
     showResults = true
```

`alignTranscription` (`lib/align.ts`) tokenizes both strings, lowercases
and strips outer punctuation (keeps internal apostrophes), then uses
`diffWords` to produce `AlignmentWord[]` with status `'correct' |
'close' | 'missing' | 'added'`. Currently `'close'` is never produced
— the scoring formula accounts for it (with a 0.5 weight) for future
synonym support.

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

### 8. End of session — mastery progression

When all chunks complete, `updateVerseProgress(verseId, difficulty,
finalScore, /* fullSession */ true)` runs in the Zustand store:

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
| `totalRecordingDurationMs` | hook | Persisted to DB at session end |
| `recordingState: 'idle' | 'recording'` | screen (useState) | No |
| `transcribing` | screen (useState) | No |
| `recordingRef`, `meteringRef`, `waveformDataRef` | screen (useRef) | No |
| `progress`, `engraved` | Zustand store → Supabase | Yes |

The recording state lives on the screen because it's tightly coupled
to animations and the audio hardware. Everything else lives in the
hook.

## Edge function — `process-recording`

`supabase/functions/process-recording/index.ts`. **Transcribes only**
— does not score.

```
Receive: multipart form-data with audio blob, durationMs, actualVerse text
  → upload audio to Soniox async API (using actualVerse as context)
  → poll Soniox until transcription completes (up to 60s)
  → optionally run cleaning pass via OpenAI GPT-5-mini (CLEANING_ENABLED = false right now)
Return: { transcription, cleanedTranscription, cleaningUsed }
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
