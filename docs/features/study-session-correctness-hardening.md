# Feature: Study Session Correctness Hardening

> **Status:** `building`
> **Author:** Caelan + Codex
> **Created:** 2026-09-17
> **Shipped:** —

## Problem

Two independent correctness problems are visible in the study loop.

First, one hidden word can look like two or more blanks. The screenshot
examples include `seventy-two`, `saying`, and `subject`. The token data is
not duplicated: `applyDifficulty()` splits on whitespace, so each remains
one `DisplayWord`. The likely fault is the iOS rendering technique in
`components/study/VerseCard.tsx`: transparent glyphs with
`textDecorationLine: 'underline'`. Native typography can interrupt an
underline around a hyphen or descenders such as `y`, `g`, and `j`, making
one logical word look like multiple blank slots.

Second, scoring compares normalized spellings but does not understand
numeric equivalence. A translation may contain `72`, `2,172`, or `666`,
while speech recognition returns `seventy-two`, `two thousand one hundred
seventy-two`, or `six hundred sixty-six` (and the reverse can also occur).
Those are acoustically correct recitations but currently become a
missing/added substitution.

A targeted translation probe confirmed this is not isolated to one source.
Eight number-heavy references were checked in ESV, NLT, NIV, and NKJV (32
remote verse fetches total), and the complete bundled KJV corpus was scanned
(789,629 tokens). Numeric presentation varies both across translations and
within a translation. Examples include `144,000` in ESV/NLT/NIV versus word
form in NKJV, `130` in ESV/NLT/NIV versus word form in NKJV, and a mixture of
digit cardinals and written ordinals within one NLT verse.

## Solution

Treat the issues as two small, separately testable changes:

1. Render every hidden `DisplayWord` with one continuous word-width blank
   indicator that does not depend on glyph underline behavior. Keep the
   existing bold weight, masking pattern, reveal animation, spacing, and
   frozen-per-session masks.
2. Extend `lib/align.ts` with strict numeric-span equivalence. Standard
   English integers and ordinals may match their digit forms bidirectionally,
   but unequal numbers remain wrong. This remains part of the existing local
   aligner; scoring, transcription, persistence, and Bible fetching do not
   change.

Validate pure behavior with deterministic tests, then exercise the real
session UI in the local iOS Simulator. Keep real-device microphone testing as
the final human check because simulator UI automation cannot prove audio
capture or speech-recognition behavior.

## Requirements

### Must have

- [x] A hidden logical word renders as exactly one continuous blank,
      including words with hyphens and descenders (`seventy-two`, `saying`,
      `subject`).
- [x] Hidden words retain the current bold/semibold visual weight; revealed
      and visible words keep their current typography.
- [x] Medium masking remains alternating, deterministic for the session, and
      computed once when chunks are created.
- [x] Digit and written forms of the same standard integer match in both
      directions (`72` ↔ `seventy-two`, `2,172` ↔ written form).
- [x] Digit and written forms of the same standard ordinal match in both
      directions (`17th` ↔ `seventeenth`, `600th` ↔ `six hundredth`).
- [x] A wrong value remains wrong (`72` must not match `70` or `seventy-third`).
- [x] Numeric equivalence preserves the expected verse's raw words in the
      alignment result so `ResultCard` rendering stays source-faithful.
- [x] Existing punctuation, apostrophe, hyphenation, filler, and split/joined
      alphabetic-compound behavior remains covered and unchanged. Generic
      digit concatenation is deliberately disallowed (`72` ≠ `7 2`).
- [x] The targeted ESV/NLT/NIV/NKJV sample and full KJV scan are recorded as
      discovery evidence; licensed remote verse corpora are not committed.
- [ ] Full-repository type check and lint return to green; pure tests and the
      targeted changed-file lint already pass, and the iOS Simulator visual
      pass is complete. The remaining full-check failures predate this branch.
- [ ] A human verifies one session on a real phone before the feature is
      called shipped.

### Nice to have

- [x] A small synthetic number-case generator that tests many digit/word pairs
      without fetching or storing licensed Bible text.

### Explicitly out of scope

- General fuzzy matching, synonyms, homophones, or activating the currently
  unused `close` score state.
- Treating differences between Bible translations as equivalent recitations.
- Changing Soniox models, cleaning prompts, or transcription transport.
- Downloading or committing a 200,000-word licensed translation corpus.
- Changing Bible cache limits, rate limits, or translation adapters.
- Database, Zustand, mastery, retry, peek-taint, or score-threshold changes.
- Claiming microphone/audio coverage from Simulator automation.

## Open Questions

### Q1: Should blank width continue to reveal approximate word length? — **DECIDED: Option A**

The current underline is as wide as the hidden word. A continuous replacement
can preserve that behavior or intentionally make every blank uniform.

- **Option A — word-width blank**: Replace glyph underline rendering with a
  continuous bottom border while keeping the hidden word's measured width.
  Familiar and minimally disruptive, but still gives a word-length hint.
- **Option B — uniform blank**: Render every hidden word at one fixed width.
  Removes the hint and is visually consistent, but changes difficulty and may
  make sentence wrapping less natural.

Decision: preserve the existing word-length hint and replace only the broken
native underline rendering.

### Q2: How broad should written-number parsing be? — **DECIDED: Option A**

The smallest safe scope covers contemporary standard cardinal and ordinal
English. KJV also contains older constructions that could be normalized.

- **Option A — standard integers and ordinals**: Handle zero through large
  scale words, optional `and`, hyphenation, commas, and ordinal suffixes.
  Lower false-positive risk and covers the observed ESV/NLT/NIV/NKJV cases.
- **Option B — include archaic KJV forms now**: Also parse forms such as
  `threescore` and `four and twenty`. Better KJV reach, but grammar and
  ambiguity expand enough to deserve their own corpus-backed tests.

Decision: ship contemporary standard integers and ordinals first. Archaic KJV
number grammar is a separate follow-up if corpus evidence shows meaningful
failures.

### Q3: How much repeatable UI automation belongs in this feature? — **DECIDED: Option C**

The app can be launched and inspected in the local iOS Simulator today, and
its login controls are visible through accessibility automation. That is
enough for agent-driven exploratory testing, but it is not yet a checked-in
test suite.

- **Option A — focused agent smoke pass**: Use the local Simulator and the
  disposable account during development, record the checklist in this doc,
  and keep committed changes limited to the two bugs. Fastest path.
- **Option B — add a Maestro smoke flow**: Check in a repeatable sign-in and
  study-navigation flow. Better regression coverage, but introduces runner
  setup and stable-selector work that is larger than these fixes.
- **Option C — separate automation feature**: Finish the correctness fixes
  with exploratory automation, then plan a broader E2E harness covering auth,
  library, settings, and sessions. Cleanest scope boundary, delayed payoff.

Decision: use agent-driven local Simulator testing for this work, but keep the
committed end-to-end harness as a separate feature.

## Technical Approach

### Data model changes

None. No tables, columns, indexes, policies, triggers, functions, or migrations
change. `session_attempts`, `user_verses.progress`, and mastery semantics are
unchanged. There is no sync impact.

### API / edge function changes

None. The Bible and transcription request/response contracts remain frozen.
Numeric normalization happens locally after transcription. The Bible cache key,
LRU behavior, version dimension, and invalidation behavior do not change.

Soniox `stt-rt-v5` and `stt-async-v5` advertise improved recognition and
formatting for structured data such as numbers, but do not contractually
guarantee digit form versus written-word form. Both current app paths already
pass the verse text as Soniox context, which improves recognition without
making output formatting deterministic. The client therefore treats Soniox as
free to return either supported representation and canonicalizes after the
final transcript string is assembled.

The broad remote corpus idea is deliberately rejected for this feature:
licensed versions have a 500-verse-per-version LRU cap and the disposable free
account has a 100-fetch/day quota. The already-completed 32-request stratified
probe is sufficient to establish the formatting problem; correctness should be
driven by synthetic unit cases and the unrestricted bundled KJV corpus.

### Client changes

- **Files added**:
  - `lib/__tests__/align.test.ts` — public-interface regression tests for
    alignment and numeric equivalence.
- **Files modified**:
  - `components/study/VerseCard.tsx` — replace transparent glyph underline
    decoration with one continuous blank primitive per `DisplayWord`; preserve
    animation and typography.
  - `lib/align.ts` — canonicalize exact numeric spans before diffing.
  - `lib/__tests__/study-chunks.test.ts` — assert punctuation, hyphens, and
    descenders do not create extra `DisplayWord` entries and masking remains
    stable.
  - `docs/architecture/study-session.md` — document the blank rendering
    invariant and exact numeric-equivalence rules after implementation.
  - `package.json`, `package-lock.json` — pin `tsx` as a development dependency
    and add a repository-owned pure-test command rather than relying on an
    ambient `npx` download.
- **Files removed**: none.

#### Continuous blank rendering

Keep `DisplayWord` as `{ text, isBlank }`; duplicated data is not the problem.
`InlineWord` uses separate rendering channels for the blank and the glyph. A
wrapping `View` reserves the word's natural width and owns an absolutely
positioned bottom line at full opacity; its nested `Animated.Text` owns only
glyph opacity. When hidden, the implemented wrapper:

1. Reserve the word's natural inline width so wrapping is unchanged.
2. Paint the glyph transparent.
3. Paint one continuous bottom edge on the always-opaque outer wrapper,
   independent of the glyph shapes.
4. Remove the edge as soon as reveal begins while fading the existing glyph in.

The reveal progress resets to zero when a blank is re-hidden, so a later
reveal animates again, with the reset running before paint so the answer cannot
flash during re-hide. The word wrappers live in a flex-wrapped row with an
inter-word column gap that follows the device font scale, keeping each word and
its line atomic when the paragraph wraps. The line is absolutely positioned
relative to that wrapper, so it does not change line or card height when it
appears or disappears.

The regression matrix must include `seventy-two`, `saying`, `subject`, a word
ending in punctuation, adjacent hidden words, the first/last word on a wrapped
line, light/dark themes, reveal, and re-hide.

#### Numeric span equivalence

Keep `tokenize()` and `alignTranscription()` as the public scoring seam. Add
private parsing helpers in `lib/align.ts`; do not create a second aligner.

Represent a parsed span as:

```ts
type NumericSpan = {
  value: number;
  kind: 'cardinal' | 'ordinal';
  consumed: number;
};
```

Parsing rules:

- Digit cardinals accept plain digits or correctly grouped commas, e.g. `72`,
  `2172`, `2,172`, `144,000`.
- Harmless whitespace around a thousands separator is normalized only when the
  surrounding groups form a valid thousands pattern (`144 , 000` → `144,000`;
  the list `1, 2` does not become `12`).
- Digit ordinals accept `1st`, `2nd`, `3rd`, and `4th`-style suffixes, rejecting
  impossible suffix/value combinations.
- Word cardinals use explicit unit, teen, tens, `hundred`, `thousand`,
  `million`, and `billion` lexicons. Scale words must descend; each three-digit
  group may use `hundred` at most once; a tens word may be followed only by a
  unit; and a teen cannot take another unit or tens word.
- Word ordinals use explicit forms (`first`, `second`, `twelfth`, `seventeenth`,
  `twentieth`, `hundredth`, etc.), must terminate the span, and use the 11th,
  12th, and 13th suffix exceptions for digit validation.
- `and` is accepted only after a completed `hundred` or larger scale and before
  a non-zero terminal sub-hundred group. It is not addition: `two and three`
  is invalid.
- Hyphenated numeric words are expanded for number parsing only; the existing
  general word normalization behavior remains unchanged. Every component of a
  hyphenated token must be numeric; `seventy-two-year-old` is not a number.
- Parsing chooses the longest fully valid span from the current token. Invalid
  orderings such as `one hundred hundred`, `twenty ten`, and `thousand one`
  fail closed.
- Article and colloquial forms (`a hundred`, `twenty-one hundred`) and archaic
  forms (`threescore`, `four and twenty`) are explicitly excluded for this
  first release.
- Parsing is exact and side-effect free. Ordinary words must not silently map
  to numbers, and cardinal/ordinal kinds must match.

Before `diffArrays`, group tokens into comparison units:

```ts
type ComparisonUnit = {
  key: string;       // normal word, or `number:cardinal:72`
  tokens: Token[];   // original raw tokens represented by this unit
};
```

Scan each side left-to-right and replace every longest valid numeric span with
one canonical unit. Diff the unit keys rather than raw normalized tokens. This
keeps unrelated adjacent words independent: expected `seventy two returned`
versus transcript `actually 72 returned` produces one added unit followed by
two equal units, rather than one opaque substitution region.

When equal numeric units are emitted, mark every expected raw token represented
by the unit `correct`. Removed/added units expand back to their original tokens.
The existing substitution post-pass remains only for alphabetic split/joined
compounds. If either side is digit-like, failed numeric parsing must not fall
back to concatenation, preventing `72` ↔ `7 2`, `10` ↔ `1 0`, and `2172` ↔
`21 72` false positives.

This keeps result rendering source-faithful: if the verse says `seventy-two`,
the result card still displays `seventy-two`, even when Soniox returned `72`.

Required positive tests are bidirectional pairs for 0, teens, tens, hyphenated
forms, hundreds with/without `and`, comma-grouped thousands, 144,000, 2,172,
666, 17th, and 600th. Required negative tests include unequal values,
cardinal-versus-ordinal, malformed comma grouping, the invalid grammars above,
mixed numeric/non-numeric hyphen compounds, unrelated prose around a number,
an inserted/omitted word immediately beside a valid number, and the digit
concatenation cases above.

### State changes

None. Masks remain frozen in each `Chunk`, and alignment output keeps the
existing `AlignmentWord[]` shape. No new Zustand, React context, AsyncStorage,
or persisted state is introduced.

The disposable simulator account is documented only in ignored local
`CLAUDE.md`; credentials are not added to tracked files.

### UI

No layout or copy redesign. The only intended visible difference is that one
hidden word has one unbroken blank. Boldness, card size, line height, spacing,
badge, eye control, reveal animation, and result-card emphasis remain as-is.

### Edge cases

- A hyphenated non-number word remains one `DisplayWord` and is not treated as
  numeric.
- A hidden word that wraps must not leave an orphan underline on either line.
- Punctuation width may remain part of the blank width, matching current
  behavior, unless Q1 chooses a broader visual redesign.
- Very large or malformed numeric phrases fail closed and use normal alignment.
- Article, colloquial, and archaic number forms are not normalized in this
  release.
- `one` may become a numeric comparison unit during the pre-diff scan, but
  canonicalization never rewrites the raw verse tokens emitted in results.
- Translation wording differences are not normalized—only exact numeric value
  and grammatical kind.
- Offline behavior is unchanged because both fixes are local.
- Simulator automation can cover layout and navigation, not microphone input,
  audio streaming, or Soniox output. Those require a real device.

### What does NOT change

- `chunk.text` remains the scoring ground truth.
- `displayWords` remains display-only and is computed once.
- `calculateChunkScore()` and `calculateFinalScore()` formulas do not change.
- Peeked chunks still contribute an all-missing alignment.
- Retries remain display-only and do not change the original score.
- Bible text is not added to `user_verses` or any new store.
- No translation adapter, cache, quota, transcription, mastery, or analytics
  behavior changes.

## Build order

1. **Lock pure regressions.** Pin `tsx`, add `npm test` for the pure Node test
   files, add alignment tests for current behavior plus failing digit/word
   cases, and expand chunk tests to prove the screenshot words are each a
   single `DisplayWord`. Files: `package.json`, `package-lock.json`,
   `lib/__tests__/align.test.ts`, `lib/__tests__/study-chunks.test.ts`. Verify
   with `npm test`. No migration.
2. **Fix blank rendering.** Implement the Q1-selected blank primitive in
   `components/study/VerseCard.tsx`. Run the pure tests, type check, lint, and
   the Simulator visual matrix. No migration.
3. **Add exact numeric equivalence.** Implement private span parsing and
   substitution matching in `lib/align.ts`; make all positive/negative tests
   pass. No migration.
4. **Run targeted product verification.** In the local Simulator, use the
   disposable account to check sign-in, a Medium session, reveal/re-hide, and
   result rendering. On a real device, recite at least one digit-source and one
   word-source number case. No migration.
5. **Record exploratory automation.** Add the completed local Simulator
   checklist to this doc; do not add Maestro, auth selectors, or unrelated UI
   changes. No migration.
6. **Graduate docs.** Update `docs/architecture/study-session.md` with the
   implemented rendering and numeric invariants, then mark this feature doc
   shipped after human device verification.

## Verification Notes

- `npm test`: 60 passing tests, including every integer from 0 through 999 in
  both directions plus representative thousands and ordinals.
- Adversarial review sweep: 20,000 randomized standard values through
  `999,999,999,999` matched their written forms with no mismatch.
- Changed-file ESLint: passes for `VerseCard`, the aligner, and both regression
  test files.
- Full `npm run lint` and `npx tsc --noEmit`: still fail on unrelated errors
  already present on `origin/main`; this branch introduces no reported error
  in a changed file.
- iOS Simulator: one continuous blank was visually confirmed for
  `seventy-two`, `saying`, and `subject`; reveal preserves the intended bold
  emphasis and removes the blank. The temporary preview route used for this
  check was deleted.
- Wrap boundaries, dark appearance, accessibility font scaling, and re-hide
  remain part of the real-device product-review checklist rather than being
  claimed as completed Simulator coverage.
- Still required before `shipped`: a real-phone session covering microphone
  capture plus one digit-source and one word-source numeric case.

## Decisions Log

| Date | Decision | Reasoning |
|---|---|---|
| 2026-09-17 | Separate blank rendering from numeric scoring | They have different causes, tests, and risk surfaces. |
| 2026-09-17 | Do not perform the proposed 200,000-word licensed remote sweep | Targeted evidence already establishes the issue; broad fetching conflicts with quotas, cache limits, and data-minimization. |
| 2026-09-17 | Keep visible/revealed boldness | Product feedback says the bold emphasis is desirable; only the broken blank is in scope. |
| 2026-09-17 | Keep test credentials out of tracked files | The local account is disposable, but credentials still do not belong in source history. |
| 2026-09-17 | Preserve word-width blanks | Fix the rendering defect without changing the memorization hint or wrapping behavior. |
| 2026-09-17 | Limit number parsing to contemporary standard integers and ordinals | Covers observed translation/ASR mismatches with a bounded false-positive surface. |
| 2026-09-17 | Defer a committed E2E harness | Use agent-driven Simulator coverage now; plan broader automation independently. |
| 2026-09-17 | Canonicalize numeric spans before diffing | Simpler than repairing substitution regions and naturally handles adjacent unrelated words. |
| 2026-09-17 | Exclude article, colloquial, and archaic number grammar | Fail safely now; add only when real transcript evidence justifies the ambiguity. |
| 2026-09-17 | Accept all six adversarial plan-review findings | Each finding exposed a concrete rendering, matching, testing, or scope failure. |

## Graduation Checklist

- [ ] Schema changes reflected in `docs/architecture/data-model.md` (N/A)
- [ ] New API or cache behavior reflected in `docs/architecture/bible-api-and-caching.md` (N/A)
- [ ] New version added to `docs/architecture/bible-versions.md` (N/A)
- [x] Session-loop changes reflected in `docs/architecture/study-session.md`
- [ ] Sync/storage changes reflected in `docs/architecture/sync-and-storage.md` (N/A)
- [ ] Auth changes reflected in `docs/architecture/auth.md` (N/A)
- [ ] Routing changes reflected in `docs/architecture/navigation-and-routing.md` (N/A)
- [ ] UI primitives changes reflected in `docs/architecture/theming-and-ui.md` (N/A unless a shared primitive is introduced)
- [ ] Library/collection changes reflected in `docs/architecture/library-and-collections.md` (N/A)
- [ ] Insights changes reflected in `docs/architecture/insights-and-streaks.md` (N/A)
- [ ] Home/VOTM changes reflected in `docs/architecture/home-and-votm.md` (N/A)
- [ ] Edge function changes reflected in `docs/architecture/edge-functions.md` (N/A)
- [ ] CLAUDE.md routing table updated (N/A)
- [x] CLAUDE.md invariants updated if exact numeric matching becomes load-bearing (N/A; the existing `lib/align.ts` invariant already routes all comparisons through this implementation)

## What Was Built

The branch now renders hidden `DisplayWord` values as word-sized containers
with continuous bottom borders, leaving the mask and reveal typography intact.
The local aligner canonicalizes strict contemporary cardinal and ordinal spans
before diffing, while preserving expected source tokens for result rendering.
A pinned pure-test command covers the old acoustic rules, number equivalence,
false-positive guards, and deterministic masking. Human real-device audio
verification remains before the feature can be marked `shipped`.
