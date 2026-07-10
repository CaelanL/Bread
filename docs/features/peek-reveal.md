# Feature: Peek / Reveal (study-session)

> **Status:** `shipped`
> **Author:** Caelan
> **Created:** 2026-06-06
> **Shipped:** 2026-07-09

## Problem

While practicing a verse in Medium or Hard mode, users sometimes want
to see the hidden words *right now* — a quick glance to jog memory or
check a phrase — without abandoning the session. Today there's no way
to reveal mid-chunk: the only way to see the masked words is to record
an attempt and complete the chunk (which auto-reveals), or to bail.

The catch is honesty. If you reveal the words *before* reciting, that
attempt shouldn't count toward your score — otherwise the difficulty
mode is meaningless and mastery (90% on Hard → engraved) is gameable.

So the feature is: a lightweight "reveal" affordance that shows the
hidden words on demand, and a guard that makes any chunk you peeked
score **zero** — as if you missed every word — so it can't inflate your
real score.

## Solution

A **reveal button** in the session header (top-right). Tapping it
un-masks the current chunk's hidden words, reusing the same staggered
reveal animation that already plays when a chunk completes.

Once a chunk has been peeked, its recorded attempt counts as **zero**
in the final score — implemented by storing an all-`missing` alignment
for that chunk, i.e. pretending every word was missed. The result card
still shows the user what they actually recited (display-only, like the
retry score) so they get feedback, but it does not feed the session
total. A peeked Hard session therefore can never hit 90, so it can't
advance engraved mastery — which is the entire point.

No database, migration, store, or edge-function changes. This lives
entirely in the session hook and screen.

## Requirements

### Must have

- [ ] A reveal **toggle** button in the session header, shown whenever
      the current chunk has hidden words (i.e. not Easy). It does NOT
      disappear after use — tap to reveal, tap again to re-hide, back
      and forth freely.
- [ ] Tapping reveal un-masks the current chunk's words using the
      existing reveal animation; tapping again re-hides them (back to
      blanks / Hard placeholder).
- [ ] **Reveal-state (shown/hidden) and taint-state are decoupled.**
      The first reveal taints the chunk permanently; re-hiding or
      re-tapping NEVER untaints it. Once peeked, always peeked.
- [ ] A peeked chunk's recorded attempt scores **0** in the final
      session score (all words counted as missing). Taint is evaluated
      at submit time, so revealing mid-recording still taints the
      in-flight attempt.
- [ ] The peek taint is per-chunk: peeking chunk 2 does not affect the
      scores of chunks 1, 3, 4.
- [ ] The user can still see what they actually recited on a peeked
      chunk — real recited score shown on the result card with a
      "won't count" banner. **This is the exact retry display pattern**
      (`ResultCard isRetry` shows the real attempt score + a banner),
      just keyed to peek instead of retry.
- [ ] The "won't count" / "revealed" tag is **persistent** — it stays
      even after the user re-hides the words, because the chunk is
      still tainted. The tag keys off `peekedChunks`, not off current
      visibility.

### Nice to have

- [ ] Subtle distinct styling for the reveal button so it reads as a
      "study aid," not a primary action.

### Explicitly out of scope

- No confirm dialog / warning before revealing. It's a ~2-minute
  practice session; an accidental peek just means practicing again.
- No mastery-impact warning. The "won't count" indication is enough;
  users will figure it out.
- No persistence of peek state across sessions (it's ephemeral session
  state, like everything else in the hook).
- No change to Easy mode behavior (nothing is hidden, so nothing to
  reveal — the button simply doesn't appear).

## Open Questions

All resolved during planning — see Decisions Log. No open questions
remain. (Agent review surfaced 13 candidate edge cases; the real ones
are folded into Edge Cases below, the rest were rejected as non-issues
— see Decisions Log for the rejected list.)

## Technical Approach

### The mechanism — copy how retry works

Retry already implements "show a score that doesn't affect the real
score" via two buckets in `hooks/use-study-session.ts`:

- `chunkResults: Map<number, ChunkResult>` — **the real score.**
  `finalScore` / mastery read only this.
- `retryResults: Map<number, ChunkResult>` — display-only.
- `retryingChunks: Set<number>` — flag marking "this chunk is
  mid-retry"; `processRecording` forks on it (line ~168).

Crucially, `calculateFinalScore` does **not** average the `score`
numbers — it re-aligns from the stored `alignment` arrays
(`use-study-session.ts:126`). So to make a chunk score 0 in the final,
we store an **all-`missing` alignment** for it. To the aggregator that
looks exactly like a chunk where every word was missed = 0%.

Peek reuses this shape, with one difference:

- **Retry** writes the real recited result to a *side* bucket
  (`retryResults`) and leaves `chunkResults` untouched → real score
  preserved.
- **Peek** writes an **all-`missing` alignment** (score 0) into the
  *main* bucket (`chunkResults`) and stashes the real recited result
  in a side bucket for display → real score tanked to 0, user still
  sees what they said.

Because `chunkResults` for a peeked chunk is locked to the
all-`missing` alignment, and retry never writes to `chunkResults`
(verified: `use-study-session.ts:168-184`), the taint is **sticky for
free** — no retry can ever restore a real score for a peeked chunk.

### Data model changes

None. No tables, columns, migrations, RLS, or functions.

### API / edge function changes

None.

### Client changes

- **Files modified:**
  - `hooks/use-study-session.ts` — add `peekedChunks` state, a
    `peekChunk(index)` action, a `peekResults` display bucket, and the
    peek branch in `processRecording`. Expose them in the return type.
  - `app/session.tsx` — add the header reveal button; pass the peeked
    state into `VerseCard`'s `revealed` prop; render the real recited
    score + "won't count" indication on a peeked chunk's card.
  - `components/study/VerseCard.tsx` — no change expected; it already
    animates `revealed`. (Confirm during build.)
- **Files added:** none.
- **Files removed:** none.

### State changes

Two **decoupled** pieces of state — taint (sticky, one-way) vs.
current visibility (free to toggle):

In `useStudySession` (ephemeral, not persisted):

- `peekedChunks: Set<number>` — the **taint** set. Add-only; once a
  chunk is in it, it never comes out. Drives the 0 score + the
  persistent banner.
- `peekResults: Map<number, ChunkResult>` — the real recited result for
  a peeked chunk (display-only, mirrors `retryResults`).
- `peekChunk(index: number)` action — adds `index` to `peekedChunks`
  (idempotent; re-calling is a no-op since it's a Set).

In `app/session.tsx` (visibility is screen-local, like recording
state):

- `revealedChunks: Set<number>` — which chunks are **currently shown**.
  Toggled both directions by the reveal button. On first toggle-on for
  a chunk, also call `session.peekChunk(index)` to taint it. Toggling
  back off does NOT touch `peekedChunks`.

The `VerseCard revealed` prop becomes
`(isCompleted && !isRetrying) || revealedChunks.has(index)`. The
banner / tag keys off `session.peekedChunks.has(index)` — so it
persists even when `revealedChunks` no longer contains the index.

In `processRecording`, before the normal `chunkResults` write, add:

```ts
const isPeeked = peekedChunks.has(currentIndex);
if (isPeeked && !isRetrying) {
  // Pretend every word was missed → scores 0 in finalScore.
  const missedAlignment = buildAllMissingAlignment(actualText);
  setChunkResults(prev => new Map(prev).set(currentIndex, {
    score: 0,
    transcription: cleanedTranscription,
    alignment: missedAlignment,
  }));
  // Stash the real recited result for display only.
  setPeekResults(prev => new Map(prev).set(currentIndex, {
    score, transcription: cleanedTranscription, alignment,
  }));
  // ...still mark completed, still run the allDone / mastery path
  //    (mastery will simply see a low score and not engrave).
}
```

`buildAllMissingAlignment(actualText)` produces an `AlignmentWord[]`
where every token has status `'missing'`. Lives in `lib/study-chunks.ts`
or `lib/align.ts` (whichever the alignment shape is defined in — confirm
during build). This is the only genuinely new pure logic.

The `allDone` / final-score / `logSessionAttempt` / `updateVerseProgress`
path stays **identical** — a peeked session just produces a lower final
score through the existing machinery. Mastery (≥90) naturally fails. No
special-casing in the store.

### UI

- **Reveal toggle button:** top-right of the session header.
  `AppHeader` **already supports `rightButton`** (`{ icon, onPress,
  variant }`) — no header change needed. Icon: an eye glyph; **needs a
  `MAPPING` entry in `components/ui/icon-symbol.tsx`** (`'eye.fill' →
  'visibility'`, and `'eye.slash.fill' → 'visibility-off'` if we swap
  the icon to reflect shown/hidden state). It is a **toggle**: tap
  shows, tap again hides.
- **Visibility rule:** the button is shown whenever the current chunk
  has at least one `isBlank` word and the chunk is not yet completed.
  It does NOT hide after being used (it's a toggle). On Easy there are
  no blanks, so it never appears. After completion the card is already
  revealed (`revealed={isCompleted && !isRetrying}`), so the toggle is
  hidden there.
- **Card reveal:** `VerseCard revealed` becomes
  `(isCompleted && !isRetrying) || revealedChunks.has(index)`. Reuses
  the existing `InlineWord` stagger animation. Re-hiding flips
  `revealed` false and the existing underline/blank state returns.
- **Peeked result card:** render the real recited score (from
  `peekResults`) using the existing `ResultCard` with a peek banner —
  the same construction as `isRetry` (`ResultCard.tsx:211-219` renders
  the retry banner). Add an `isPeeked` prop / banner variant ("Revealed
  — won't count"). If a chunk is both peeked and retried, show the peek
  banner (the taint dominates; retry can't recover it anyway).
- **Persistent tag:** keyed off `peekedChunks.has(index)`, not
  `revealedChunks` — so it stays visible after re-hiding.

**Reveal during recording:** allowed. Toggling `revealedChunks` is
pure UI state and does not touch `recordingRef`, the metering loop, or
the audio session. Taint is checked at submit time
(`peekedChunks.has(currentIndex)` inside `processRecording`), so a
mid-recording reveal still zeroes the in-flight attempt. **Build-time
verification:** confirm the reveal toggle does not trigger a layout
jump that trips `onViewableItemsChanged` (`session.tsx:252`), which
cancels active recordings on scroll. If a real bug surfaces, fall back
to disabling the button only while `recordingState === 'recording'`.

### Edge cases

- **Reveal while recording / transcribing:** allowed (see UI note).
  Pure UI state; taint evaluated at submit. Verify no layout jump
  trips the scroll-away recording-cancel during build.
- **Toggle back and forth:** re-hiding never untaints. `revealedChunks`
  flips both ways; `peekedChunks` is add-only. Tag persists.
- **Offline:** unchanged. Peek is local-only; recording still requires
  network for transcription. A peeked session logged offline is lost
  like any other (existing behavior, invariant #10).
- **Single-chunk session:** if the only chunk is peeked, the session
  final score is 0 (correct — you peeked the whole thing). Retry is
  already hidden on single-chunk sessions (`session.tsx:425`), so no
  weird retry interaction. The persistent peek banner carries the
  meaning. The 0% attempt is logged to `session_attempts` with no peek
  marker — acceptable per "accidental ruined scores are fine."
- **Peek after completion:** the toggle is hidden once the chunk is
  completed (card already revealed), so you can't newly taint a
  finished chunk. No TOCTOU window.
- **Peek then retry:** retry shows a practice score (existing
  `retryResults` path); the real `chunkResults` stays the all-`missing`
  zero. The peek banner dominates over the retry banner. Sticky.
- **Already-engraved verse + peeked session:** safe. A 0 score sets
  `bestAccuracy`/`completed` but the SR engraved path only *advances*
  on ≥90 (`lib/store/index.ts` ~`isQualifyingReview`); a 0 never
  decrements `passCount` or un-engraves. Peeking cannot damage existing
  mastery.
- **Scrolling away mid-peek:** `revealedChunks` is keyed per index, so
  scrolling just changes `currentIndex`; a revealed chunk stays
  revealed and a tainted one stays tainted.

### What does NOT change

- `chunkResults` remains the single source of truth for `finalScore`
  and mastery (invariant preserved).
- `calculateFinalScore`, `calculateChunkScore`, `alignTranscription` —
  untouched. Peek expresses "missed everything" *through* the existing
  alignment shape, not by special-casing the scorer.
- Mastery / engraved logic in the Zustand store — untouched.
- Retry behavior — untouched; peek sits alongside it.
- No DB / migration / edge function / sync changes.

## Build order

1. **Pure logic + hook state.** Add `buildAllMissingAlignment`,
   `peekedChunks`, `peekResults`, `peekChunk`, and the peek branch in
   `processRecording`. Expose in the hook return. App still works
   (button not wired yet).
   - Files: `lib/study-chunks.ts` (or `lib/align.ts`),
     `hooks/use-study-session.ts`.
2. **Reveal button + card reveal.** Add the header reveal button with
   the visibility rule, wire `peekChunk`, OR the peeked state into
   `VerseCard revealed`. Add the eye icon mapping.
   - Files: `app/session.tsx`, `components/ui/icon-symbol.tsx`,
     (`components/app-header.tsx` if a right slot is needed).
3. **Peeked result card indication.** Show the real recited score +
   "won't count" tag on a peeked chunk's card.
   - Files: `app/session.tsx`, possibly `components/study/ResultCard.tsx`.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-06-06 | Peeked chunk scores 0 (all words missing), not "exclude from average" or "void whole session" | Simplest; reuses existing scorer with no special-casing; ungameable; naturally blocks mastery |
| 2026-06-06 | Taint is per-chunk and sticky; no "clear on retry" | Retry already never touches `chunkResults`, so stickiness is automatic — there was no real decision to make |
| 2026-06-06 | Reveal is a TOGGLE, not a one-shot. Button never disappears | Users go back and forth (peek, self-test, peek again). Decouple visibility (`revealedChunks`, screen-local, two-way) from taint (`peekedChunks`, hook, one-way) |
| 2026-06-06 | Re-hiding never untaints; "won't count" tag persists after re-hide | Re-hiding the text shouldn't hide the *fact* that you looked. Tag keys off `peekedChunks`, not visibility |
| 2026-06-06 | Card shows real recited score + banner (= retry's display pattern), option (a) | User explicitly said "copy retry." Retry shows the real attempt score + a banner; peek does the same |
| 2026-06-06 | Reveal allowed during recording; taint checked at submit | User wants it to work mid-recording. Safe because reveal is pure UI state; verify no scroll-jump bug at build time, fall back to disable-while-recording only if needed |
| 2026-06-06 | No confirm dialog or mastery warning | Lightweight feature; accidental peek just means practicing again |
| 2026-06-06 | Reveal toggle hidden after chunk completes | Card is already revealed post-completion; closes the peek-after-complete window |
| 2026-06-06 | **Rejected** review findings: TOCTOU on last chunk, empty-results-page scroll, peek-without-record discarded, Hard reveal shows underscores, progress-bar peek color | Investigated each against code — not real: completion hides the toggle; peek doesn't drive navigation or complete chunks; Hard `displayWords` carry real text rendered on reveal; progress bar is a completion indicator, not quality |

## Graduation Checklist

- [x] Session-loop changes reflected in `docs/architecture/study-session.md`
      (added § 7b "Peek / Reveal" + peek/hide rows in the State table)
- [x] CLAUDE.md invariants — no new rule needed; the existing
      `chunkResults`-is-truth invariant covers the taint mechanism

## What Was Built

Implemented, with on-device iteration (eye moved from header to card,
2x peek reveal, Easy-all placeholder redesigned after the invisible-text
approach proved janky on long chunks):

- `lib/study-chunks.ts` — `HideMode` type + `maskDisplayWords(words,
  mode, seed)`: cosmetic re-mask (show / some / all). Preserves each
  word's `text`, only flips `isBlank`.
- `lib/align.ts` — `buildAllMissingAlignment(text)` =
  `alignTranscription(text, '')`, reusing the existing tokenizer to
  produce an all-`missing` alignment (scores 0).
- `hooks/use-study-session.ts` — `peekedChunks` (sticky taint set),
  `peekResults` (display-only real recited result), `peekChunk`,
  `getPeekResult`, lifted `sessionSeed` into state. `processRecording`
  gained a peek branch: a peeked first attempt stores the all-`missing`
  alignment (score 0) in `chunkResults`, stashes the real result in
  `peekResults`, and the `allDone` final-score path uses the 0
  alignment.
- `app/session.tsx` — `hideModes` map (screen-local visibility); the
  eye / eye.slash toggle lives in the **top-right of each VerseCard**
  (moved out of the header) and cycles on Easy (show → some → all →
  show) / toggles on Medium/Hard (taints via `peekChunk` on reveal).
  Per-chunk effective `displayWords` + `revealed` resolution, with
  **completion winning over any hide override** (a finished chunk
  always shows its text). Peeked chunks render the real recited score
  on the result card + a peek banner; score badge shows the real
  recited score (session total still uses 0). Easy "some" seed varies
  per chunk via `verseNum`.
- `components/study/VerseCard.tsx` — owns the visibility toggle button
  (`visibilityIcon` + `onToggleVisibility`, hidden once completed).
  `revealFast` runs the peek reveal at 2x (15ms stagger / 100ms fade);
  completion reveals keep the original 30ms / 200ms. `memoryPlaceholder`
  (Easy "all") renders the exact placeholder Hard uses (circled
  lightbulb + "Recite from memory") instead of a wall of underscores.
  The card resizes to the placeholder; the existing `Layout` animation
  smooths the transition. (An invisible-text trick that held the card's
  size was tried and rejected — long chunks made the placeholder sit in
  a scrollable void.)
- `components/study/ResultCard.tsx` — `isPeeked` prop + "Revealed — this
  chunk won't count" banner; chrome budget accounts for it.
- `components/ui/icon-symbol.tsx` — `eye` → `visibility`, `eye.slash` →
  `visibility-off`.

Verification: `tsc` and `eslint` introduce no new errors (pre-existing
errors in these files remain untouched). A skeptical agent review found
**no correctness bugs**; the one cosmetic finding worth acting on
(degenerate Easy "some" pattern) was addressed via per-chunk seed
variation. Remaining: human device testing.
