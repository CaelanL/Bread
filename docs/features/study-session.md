# Study Session

The core loop. A reader opens a saved passage, picks a difficulty and a chunk
size, then recites one chunk at a time. Each recitation is transcribed, aligned
against the verse on the device, and scored. The session ends with one score,
which goes to the store and to `session_attempts`.

Recording and transcripts: `docs/features/transcription.md`. Mastery and
engraved rules: `docs/features/review.md`.

## Where things live

| Layer | File | Role |
|---|---|---|
| Setup | `app/(tabs)/(library)/setup/[id].tsx`, `components/study/ChunkSizeModal.tsx` | Difficulty, chunk size, remembered prefs |
| Screen | `app/session.tsx` | Animations, recorder, per-chunk visibility, results page |
| Session state | `hooks/use-study-session.ts` (`useStudySession`) | Chunks, results, peek and retry state, saving |
| Pure logic | `lib/study-chunks.ts`, `lib/align.ts` | Chunks, masks, score formulas, alignment |
| Cards | `components/study/VerseCard.tsx`, `components/study/ResultCard.tsx` | Verse and result rendering |
| Tests | `lib/__tests__/study-chunks.test.ts`, `lib/__tests__/align.test.ts` | Run with `npm test` |

The screen keeps only recorder and animation state plus `hideModes`. Nothing is
persisted until the session saves.

## Setup screen

`StudySetupScreen` reads the verse from the store with `useVerse`, so it opens
without a fetch. Verse text loads through `getVerseText`, keyed on
`verse?.id`: saving prefs swaps the verse object and would flash the loader.

- **Difficulty:** Easy ("All words"), Medium ("Some hidden"), Hard ("No words").
- **Verses per chunk:** shown only for multi-verse passages. A value pill opens
  `ChunkSizeModal`, where a tap on 1..N-1 or "All" commits and closes. An "All"
  button sits beside the pill too.
- **Start session:** a floating pill. `handleStartSession` is the only route into
  the session: `/session?id=<verseId>&difficulty=<d>&chunkSize=<n>`.
- Also `ProgressCard`, a passage preview sized by `useSafeAreaFrame` height, and
  Reset Progress in the menu.

### Remembered prefs

Chunk size and difficulty are saved per verse in `user_verses.last_chunk_size`
and `last_difficulty`. `savePrefs` runs on every change and again on Start.
`setVerseStudyPrefs` in `lib/store/index.ts` no-ops when nothing changed and
writes fire-and-forget, so a lost write just means defaults next time. Prefs are
shared across collections, and Reset Progress leaves them alone. Storage detail:
`docs/architecture/data-model.md`.

Restore runs once per screen open, behind `defaultsApplied`:

1. The saved value wins. A saved chunk size is clamped to the verse count.
2. With nothing saved, a verse with `progress.hard.completed` opens on Hard with
   the whole passage as one chunk.
3. Everything else opens on Easy with 1-verse chunks.

## Session load

`useStudySession` loads once per verse, difficulty and chunk size:

1. Once the store is hydrated, `findVerse` (store) reads the verse from `verses`,
   then `masteredVerses`, like `useVerse`, so a removed mastered verse opens.
2. Text in memory (`peekVerseText`) seeds the first frame, with no loader;
   else `getVerseText` fetches it ([rules](../architecture/bible-api-and-caching.md)).
3. `sessionSeed` is drawn as 0 or 1, and `parseVerseIntoChunks` builds the chunks.

A missing verse or a failed text fetch shows a message and Close.

## Chunks

`parseVerseIntoChunks(verse, difficulty, chunkSize, sessionSeed)` gives one chunk
for a single verse, a range without keyed verses, or `chunkSize >= totalVerses`,
and otherwise groups consecutive verses by `chunkSize`. Each `Chunk` has:

- `id`: `<verseId>:<start>` or `<verseId>:<start>-<end>`, the `FlatList` key.
- `text`: plain verse text with no verse numbers.
- `displayWords`: `{ text, isBlank }[]`, built from the text with a superscript
  verse number prefixed to each verse's first word.

Keyed text (`verse.verses`) is the source. A verse the translation omits gets no
chunk. `getVerseText` throws on a range without keyed verses.

**`chunk.text` is the ground truth for scoring (invariant 4).** Inside a session,
scoring compares the transcription against `chunks[i].text`, the plain verse. It
never compares against `displayWords`, which carry the masks and the superscript
numbers.

## Masks and difficulty

`applyDifficulty(text, difficulty, seed)` splits on any whitespace, so interior
newlines in poetry can't create empty tokens or shift Medium's pattern.

| Difficulty | `isBlank` | On screen |
|---|---|---|
| Easy | never | All words |
| Medium | every other word, first blank set by `seed % 2` | Underlined blanks |
| Hard | always | "Recite from memory" placeholder, until revealed |

**Chunk masks are computed once at session start and frozen (invariant 5).**
`parseVerseIntoChunks` stores `displayWords` on each chunk, and they are never
recomputed on render. The seed is `hashString(chunk.id) + sessionSeed`, with
`sessionSeed` drawn once in `useStudySession`. The pattern holds for the whole
session, and a new session may flip it, so nobody memorizes the blanks. A new
seed mid-session would move Medium's blanks under the reader.

`InlineWord` in `VerseCard` draws one blank per word. A wrapper `View` holds the
word's natural width, the glyph is transparent, and the wrapper owns an absolute
bottom line, not a native text underline (see Decisions). Reveal animates glyph
opacity only, and re-hide resets it in a layout effect, so the answer can't flash.

## Peek and reveal

An eye button sits on each `VerseCard` until the chunk completes, and comes back during a Retry. Visibility
(`hideModes`, screen-local) is separate from taint (`peekedChunksRef`, hook).

- **Medium and Hard:** the button toggles the chunk's words, at twice the normal
  reveal speed. Any reveal calls `peekChunk`. Taint is per-chunk, sticky and
  one-way, and re-hiding never clears it.
- **Easy:** no taint. The button cycles show, some, all. "Some" is
  `maskDisplayWords`, a cosmetic mask computed in render from
  `sessionSeed + verseNum`. "All" shows the Hard placeholder.

A tainted chunk's attempt stores `buildAllMissingAlignment(chunk.text)` as its
scored alignment, so its words count as missing through the normal aggregator.
The scorer has no peek case. The same chunk keeps the real recited result for
display, with the banner "Revealed — this chunk won't count". Other chunks score
normally. A reveal during recording counts. The submit tap captures the taint
for the recorded chunk, and the eye is unavailable during analysis.

A finished chunk always shows its text, whatever its hide mode. While a chunk is
being retried, its hide mode applies again.

## Alignment

**Use `lib/align.ts` for any verse-versus-transcription comparison (invariant
6).** `alignTranscription(expected, spoken)` produces the `AlignmentWord[]` that
scoring depends on. Each word is `correct`, `missing`, or `added`. `close` is in
the formula, but nothing produces it yet.

The rule: a person is talking, not spelling. A word written differently but said
the same is correct, and the card shows the verse's word. Rulings:
`docs/grading-audit.md` Decisions.

- `tokenize` drops invisible characters and splits words glued by punctuation,
  never at apostrophes, hyphens or between digits.
- `normalize` folds case, accents, apostrophes and hyphens. Vocative "O" is
  "oh". "Moses's" matches "Moses'" only when the other side has that form, never
  plain "Moses" (`foldDoublePossessives`).
- `SPELLINGS` in `lib/align-spellings.ts` gives British, KJV-era and name
  spellings one key. Other words (ye, spake, hath) stay wrong.
- `FILLERS` (um, erm, uh-huh) drop from the transcript only. "Ah", "er" and
  "err" are scripture.
- `joinCompounds` matches split and joined words ("for as much", "forasmuch").
  Digits never join, so `72` doesn't match `7 2`.
- `alignSubstitution` re-diffs an unmatched stretch and skips stray words, so
  a slip or restart costs only its own words.

Numbers become one unit before `diffArrays` runs, keyed by value and kind, so `72`
matches `seventy-two`, never `70` or `72nd`. It also reads `an hundred`,
`600 thousand`, fractions (`3-1/4`) and `-fold`; a span stops at
punctuation. "five and twenty" or "an hundred and thirty and seven"
count only if the other side has 25 or 137 (`mergeContextNumbers`). `threescore` and "six six six" fail closed.

## Scoring

In `lib/study-chunks.ts`, each of these rounds, and an empty alignment scores 0:

```
(correct + 0.5*close) / (correct + close + missing + added) * 100
```

| Function | Scope |
|---|---|
| `calculateChunkScore` | One chunk's alignment |
| `calculateFinalScore` | All of `chunkResults`, pooled by word, not an average of chunk percentages |
| `calculatePartialScore` | Early exit: pooled results, plus every word of each uncompleted chunk as missing |

`processRecording` in the hook gets a transcript (see
`docs/features/transcription.md`), aligns it locally, scores it, and stores it.

`ResultCard` shows "% match" with "Perfect!" when nothing is marked (`isPerfect`),
"Great!" for other passes, "Good effort!" at 65+, "Keep Practicing" below. A help
icon opens `AlignmentHelpModal`.

### Retry

Retry starts another recording for a completed chunk on finger-down (a swipe
starting on Retry records) as the result card fades. The attempt owns the retry state. A successful
retry replaces only that chunk's practice result, so its scored result stands.
Discarding, leaving the chunk or failing restores the previous result and
controls. Retry is hidden on single-chunk sessions. The result card shows retry
first, then peek, then the original.

## Finishing a session

The final score computes only once every chunk has a result. Then the hook:

1. Calls `updateVerseProgress(verseId, difficulty, finalScore, true)` without
   awaiting it. A failure shows the toast "Failed to save your progress."
2. Calls `logSessionAttempt`, fire-and-forget, console-only on failure.
3. Sets `showResults`. The list gains a results page, and Next reads "See
   Results". That page is `components/study/SessionFinish.tsx`: the first time it
   shows, the score counts up while a line fills toward a 90 mark (`Motion.scoreMs`).
   A pass turns them green, plays a success haptic and runs the finished-line
   highlight (`Sweep`), titled "<Difficulty> passed" with the next step. A miss keeps a
   black line and reads "Almost there" (65 or more) or "Keep practicing", then "90% to
   pass". Then Done, and Review chunks back to the first chunk.

A chunk that scores 90 or more without a reveal plays a success haptic too.

Once every chunk has a result, a black exit button (door and arrow) sits left of Retry and See Results. It calls `done`, since
the score is already saved, and leaves without the results page.

**Early exit.** The X in the header calls `saveAndExit`. With some chunks complete
but not all, it calls `updateVerseProgress` with `calculatePartialScore` and no
`fullSession` flag, logs an attempt, and leaves at once. A failed save
shows the save-error toast after it leaves. Otherwise it just leaves. Exiting discards an in-flight recording or
analysis. A late transcript cannot update the session or save a second attempt.

**Session attempts.** A session writes at most one `session_attempts` row, from
one of those two call sites, through `logSessionAttempt` in `lib/api/analytics.ts`.
`recording_duration_ms` sums the audio of every recording that got a transcript,
retries included, up to the write. Waiting time, cancelled recordings and failed
recordings don't count. A peeked session has no marker in its row. Columns:
`docs/architecture/data-model.md`. Readers: `docs/features/insights.md`.

## Sharp edges

- **Partial scores can mark mastery.** See `docs/features/review.md`.
- **Partial scores read low.** One of two equal chunks at 100% saves about 50%.
- **Two `getVerseText`s.** `lib/api/bible.ts` fetches. `lib/study-chunks.ts` is the
  deprecated splitter.

## Browser checks

- `npm run sim -- shot "/(tabs)/(library)/setup/seed-psalm-23-1-3" --as reader-a`: Easy selected, "Verses per chunk" at 1 with All beside it, "Start session" pill.
- `npm run sim -- shot "/(tabs)/(library)/setup/seed-john-3-16" --as reader-a`: Hard selected (mastered with nothing saved), no chunk row.
- `npm run sim -- shot "/session?id=seed-psalm-23-1-3&difficulty=medium&chunkSize=1" --as reader-a`: "Verse 1" card with every other word as one unbroken blank, three progress segments, mic button. Needs the local `bible` function serving ESV.
- `npm run sim -- flow practice-session`: reader-a opens Psalm 23:1-3 setup, picks Medium, taps Start session, sees "Verse 1" and the mic, taps the mic and gets the iOS microphone prompt. Don't Allow shows "Permission required" and dismissing it restores the mic.
- `npm run sim -- flow practice-removed-mastered`: reader-a's mastered John 3:16, removed from My Verses, still starts a session; the flow puts it back.
- `npm run sim -- shot "/session?id=x" --as reader-a`: Close and "This verse is no longer in your library."
- `npm run sim -- shot "/dev-result-card?card=<expected>|<transcript>"` (`app/dev-result-card.tsx`), light and dark. KJV Romans 6:23 both sides: 100%, "Perfect!". Without "eternal": 95%, "Great!", "eternal" underlined.
- `npm run sim -- flow recording-controls`: start and discard a recording, then double-tap the mic. A ring shows until capture starts, then the pill with waveform and actions. The double tap records once.
- `npm run sim -- flow mic-denied-again`: deny the prompt, tap the mic again: one "Permission required".
- Real device, Medium, multi-verse: tap the eye, re-hide, recite, submit. The card shows the real score and "Revealed — this chunk won't count", and the final score treats those words as missing.

## Decisions

- 2026-04-26 · Retries are display-only and never change `chunkResults` · One attempt counts, so practice is free. Hidden on single-chunk sessions (2026-04-30), where it would mislead.
- 2026-05-01 · Chunk picker is a tap-to-commit modal, with a floating Start pill over a scrolling form · The old dropdown overlapped the form on small phones.
- 2026-06-06 · A peeked chunk scores 0 through an all-`missing` alignment, with no confirm dialog · No scorer special case, can't be gamed, and a peeked Hard session can't reach 90.
- 2026-08-25 · Scoring formula `(correct + 0.5*close) / (correct + close + missing + added)` in `lib/study-chunks.ts` is deliberate · Added words count in the denominator to reward clean recitation. Fix fairness in alignment normalization, never in the formula.
- 2026-08-25 · Prefs are per-verse columns, not `progress` keys; mastered verses with none open on Hard, whole passage · `progress` round-trips through `parseProgress`, so older clients would clobber JSONB keys. Engraved reviews only qualify on Hard, so Easy would stall them.
- 2026-09-17 · Blanks are drawn apart from the glyph and stay word-width · A native underline breaks at hyphens and descenders, so one word looked like several blanks.
- 2026-09-17 · Numbers compare as canonical spans before the diff · Translations and the recognizer both mix digits and words. Exact value and kind keep false positives out.
- 2026-11-12 · The session reads its verse from the store, not a second query · Same lookup as setup, so removed mastered verses open and failures show.
- 2026-11-15 · "Perfect!" only when nothing is marked, else "Great!" · Visible marks aren't perfect, even at a rounded 100.
