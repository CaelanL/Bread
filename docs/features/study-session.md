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

Session state lives in `useStudySession`. The screen keeps only recorder and
animation state plus `hideModes`. Nothing is persisted until the session saves.

## Setup screen

`StudySetupScreen` reads the verse from the store with `useVerse`, so it opens
without a fetch. Verse text then loads through `getVerseText` in
`lib/api/bible.ts`, keyed on `verse?.id`, because saving prefs swaps the verse
object and re-running would flash the loader.

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

1. `getSavedVerses()` from `lib/storage` queries Supabase for the verse. This is
   a network read, not the store.
2. If `text` or `verses` is missing, `getVerseText` fetches them. Read rules:
   `docs/architecture/bible-api-and-caching.md`.
3. `sessionSeed` is drawn as 0 or 1, and `parseVerseIntoChunks` builds the chunks.

## Chunks

`parseVerseIntoChunks(verse, difficulty, chunkSize, sessionSeed)` gives one chunk
for a single verse or when `chunkSize >= totalVerses`, and otherwise groups
consecutive verses by `chunkSize`. Each `Chunk` has:

- `id`: `<verseId>:<start>` or `<verseId>:<start>-<end>`, the `FlatList` key.
- `text`: plain verse text with no verse numbers.
- `displayWords`: `{ text, isBlank }[]`, built from the text with a superscript
  verse number prefixed to each verse's first word.

Keyed text (`verse.verses`) is the correct source. With no keyed data, a
deprecated fallback splits on sentences and then on words. Neither lines up with
real verses.

**`chunk.text` is the ground truth for scoring (invariant 4).** Inside a session,
scoring compares the transcription against `chunks[i].text`, the plain verse. It
never compares against `displayWords`, which carry the masks and the superscript
numbers. If you change how chunks are built, preserve this.

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
bottom line. Don't use a native text underline: it breaks around hyphens and
descenders, so one word looks like several blanks. Reveal animates glyph opacity
only, and re-hide resets it in a layout effect, so the answer can't flash.

## Peek and reveal

An eye button sits on each `VerseCard` until the chunk completes. Visibility
(`hideModes`, screen-local) is separate from taint (`peekedChunks`, hook).

- **Medium and Hard:** the button toggles the chunk's words, at twice the normal
  reveal speed. Any reveal calls `peekChunk`. Taint is per-chunk, sticky and
  one-way, and re-hiding never clears it.
- **Easy:** no taint. The button cycles show, some, all. "Some" is
  `maskDisplayWords`, a cosmetic mask computed in render from
  `sessionSeed + verseNum`. "All" shows the Hard placeholder.

A tainted chunk's attempt stores `buildAllMissingAlignment(chunk.text)` in
`chunkResults`, so its words count as missing through the normal aggregator. The
scorer has no peek case. The real recited result goes to `peekResults` for
display, with the banner "Revealed — this chunk won't count". Other chunks score
normally. A reveal during recording counts, because `processRecording` reads the
taint when submit is tapped.

A finished chunk always shows its text, whatever its hide mode. While a chunk is
being retried, its hide mode applies again.

## Alignment

**Use `lib/align.ts` for any verse-versus-transcription comparison (invariant
6).** Don't roll your own word matching. `alignTranscription(expected, spoken)`
handles tokenizing and normalizing, and produces the `AlignmentWord[]` that
scoring depends on. Each word is `correct`, `missing`, or `added`. `close` exists
in the type and the formula, but nothing produces it yet.

The rule: never penalize a difference the recognizer can't hear.

- Text splits on whitespace and after em and en dashes.
- Normalizing lowercases, drops apostrophes and hyphens, and strips outer
  punctuation, so "eagle's" matches "eagles". Vocative "O" folds to "oh".
- Spoken fillers (`FILLERS`: um, uh, hmm and friends) drop from the transcript
  side only. "Ah" and "er" stay, because they occur in scripture.
- Split and joined alphabetic compounds match by concatenation ("for ever" and
  "forever"). Digits never do this, so `72` doesn't match `7 2`.

Numbers become one comparison unit before `diffArrays` runs, keyed by value and
kind. So `72` matches `seventy-two` and `17th` matches `seventeenth`, while `72`
never matches `70` or `seventy-second`. The grammar is contemporary integers and
ordinals up to billions. Malformed spans, article and colloquial forms
(`a hundred`, `twenty-one hundred`) and archaic forms (`threescore`) fail closed
and diff as plain words. Results always show the saved translation's own wording
for matched words.

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
There is no live or incremental scoring.

`ResultCard` shows "% match" with "Perfect!" at 90 or more, "Good effort!" at 65
or more, and "Keep Practicing" below that. A help icon opens
`AlignmentHelpModal`.

### Retry

After a chunk completes, the retry button collapses its result card and starts
recording again. The result goes to `retryResults` and never touches
`chunkResults`, so the score stands. Retry is hidden on single-chunk sessions. The
result card shows retry first, then peek, then the original.

## Finishing a session

The final score computes only once every chunk has a result. Then the hook:

1. Calls `updateVerseProgress(verseId, difficulty, finalScore, true)` without
   awaiting it. A failure shows the toast "Failed to save your progress."
2. Calls `logSessionAttempt`, fire-and-forget, console-only on failure.
3. Sets `showResults`. The list gains a results page, and Next reads "See
   Results". That page shows the score, passing at 90 or more, View Results and
   Done.

**Early exit.** The X in the header calls `saveAndExit`. With some chunks complete
but not all, it calls `updateVerseProgress` with `calculatePartialScore` and no
`fullSession` flag, logs an attempt, and leaves at once. Failures only reach the
console. Otherwise it just leaves. A recording in progress is thrown away on
unmount.

**Session attempts.** A session writes at most one `session_attempts` row, from
one of those two call sites, through `logSessionAttempt` in `lib/api/analytics.ts`.
`recording_duration_ms` sums the audio of every recording that got a transcript,
retries included, up to the write. Waiting time, cancelled recordings and failed
recordings don't count. A peeked session has no marker in its row. Columns:
`docs/architecture/data-model.md`. Readers: `docs/features/insights.md`.

## Sharp edges

- **Load failure traps the reader.** `loadVerse` has no catch, so a thrown
  `getVerseText` (offline, rate limit) leaves the spinner up forever. A verse
  `getSavedVerses` can't find gives "Something went wrong". Neither state renders
  a header, and the screen is a `fullScreenModal`, so iOS has no way out.
- **Soft-deleted mastered verses can't start a session.** Setup finds them through
  `useVerse`, but `getSavedVerses` filters on `deleted_at`, so the session lands on
  "Something went wrong".
- **Reveal after the submit tap.** `processRecording` reads `peekedChunks` from the
  render at the tap. A reveal while transcribing leaves the attempt scored normally,
  while the screen treats the chunk as peeked with no `peekResults` entry, so no
  score badge or result card shows.
- **Exiting while transcribing.** `processRecording` isn't cancelled. If the
  in-flight chunk was the last, `saveAndExit` writes a partial attempt and the
  finished call writes a second, full one. Otherwise the result is dropped.
- **Partial scores can mark mastery.** See `docs/features/review.md`.
- **Partial scores read low.** One of two equal chunks at 100% saves about 50%.
- **Empty chunks.** A keyed map missing a verse gives a chunk with empty `text`,
  which the batch path rejects, so the chunk can't complete. The fetch layer must
  never emit a bad map; `lib/__tests__/study-chunks.test.ts` shows why.
- **Two `getVerseText`s.** `lib/api/bible.ts` fetches. `lib/study-chunks.ts` is the
  deprecated splitter.

## Browser checks

- `npm run sim -- shot "/(tabs)/(library)/setup/seed-psalm-23-1-3" --as reader-a`: Easy selected, "Verses per chunk" at 1 with All beside it, "Start session" pill.
- `npm run sim -- shot "/(tabs)/(library)/setup/seed-john-3-16" --as reader-a`: Hard selected (mastered with nothing saved), no chunk row.
- `npm run sim -- shot "/session?id=seed-psalm-23-1-3&difficulty=medium&chunkSize=1" --as reader-a`: "Verse 1" card with every other word as one unbroken blank, three progress segments, mic button. Needs the local `bible` function serving ESV.
- `npm run sim -- flow practice-session`: reader-a opens Psalm 23:1-3 setup, picks Medium, taps Start session, sees "Verse 1" and the mic, taps the mic and gets the iOS microphone prompt. Don't Allow shows "Permission required".
- Real device, Medium, multi-verse: tap the eye, re-hide, recite, submit. The card shows the real score and "Revealed — this chunk won't count", and the final score treats those words as missing.

## Decisions

- 2026-04-26 · Retries are display-only and never change `chunkResults` · One attempt counts, so practice is free. Hidden on single-chunk sessions (2026-04-30), where it would mislead.
- 2026-05-01 · Chunk picker is a tap-to-commit modal, with a floating Start pill over a scrolling form · The old dropdown overlapped the form on small phones.
- 2026-06-06 · A peeked chunk scores 0 through an all-`missing` alignment, with no confirm dialog · No scorer special case, can't be gamed, and a peeked Hard session can't reach 90. An accidental peek just means practicing again.
- 2026-08-25 · Scoring formula `(correct + 0.5*close) / (correct + close + missing + added)` in `lib/study-chunks.ts` is deliberate · Added words count in the denominator to reward clean recitation. Fix fairness in alignment normalization, never in the formula. Don't re-propose it.
- 2026-08-25 · Prefs are per-verse columns, not `progress` keys; mastered verses with none open on Hard, whole passage · `progress` round-trips through `parseProgress`, so older clients would clobber JSONB keys. Engraved reviews only qualify on Hard, so Easy would stall them.
- 2026-09-17 · Blanks are drawn apart from the glyph and stay word-width · Fixes one word looking like several blanks, without changing the length hint or wrapping.
- 2026-09-17 · Numbers compare as canonical spans before the diff, standard grammar only · Translations and the recognizer both mix digits and words. Exact value and kind keep false positives out.
