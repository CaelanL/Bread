# Grading audit

Every known way Bread grades a correct recitation wrong, ranked, with the cause, a runnable
repro and a suggested fix. Next to them, things found on the way that fail recordings or let
wrong recitations pass. Nothing here changed how the app grades; each fix is a decision for
Caelan.

Grading itself is described in `docs/features/study-session.md` (alignment, scoring) and
`docs/features/transcription.md` (the two transcription paths).

## How to run

The harness feeds "correct" recitations through the app's own `parseVerseIntoChunks`,
`alignTranscription` and `calculateChunkScore`, and reports every chunk under 100 and every
chunk where the same word is both missing and added.

| Command | What it does |
|---|---|
| `npm run audit:grading` | Every variation pass over all 31,102 bundled KJV verses, one verse per chunk |
| `npm run audit:grading -- --pass <prefix>` | Passes whose name starts with the prefix (`digits:`, `spelling:`, `compound:`, `homophone:`, `contraction:`, `unicode:`, `speech:`, `reference:`, `live:`) |
| `npm run audit:grading -- --chunk-size 3` | Multi-verse chunks. `reference:verse-numbers-in-chunk` checks nothing at the default size 1 |
| `npm run audit:grading -- --check-chunks` | Chunk building at sizes 1, 2, 3, 5 and all, three difficulties, keyed and fallback |
| `npm run audit:grading -- --replay scripts/grading-audit/fixtures/say-kjv.json` | Replays 457 real Soniox transcripts of computer-voice KJV recitations |
| `npm run audit:grading -- --card --ref "<ref>" --transcript "<text>"` | One result card: `__word__` missing (underlined amber), `~~word~~` added (struck red) |
| `npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts` | ESV verse text from the local `bible` function, checked against the chapter path (RC5) |
| `npx tsx scripts/grading-audit/fetch-licensed.ts ESV` | Fetches a licensed sample into gitignored `.expo/grading-audit/ESV.json` for `--source ESV` |
| `npx tsx scripts/grading-audit/voice.ts` | Records computer-voice clips and sends them to Soniox (costs Soniox usage; see the file header) |

Add `--aligner <file>` to `--card`, `--replay` or a pass run to use an older aligner. Set them up
from git:

```
mkdir -p .expo/grading-audit
git show 0a63382^:lib/align.ts > .expo/grading-audit/old-align.ts           # 1.3.0
git show 041aa49^:lib/align.ts > .expo/grading-audit/align-pre-041aa49.ts   # 1.1.1 and 1.2.0
```

Licensed text is never printed or committed: `--source ESV` reports references and the words
that went wrong, `esv-text.ts` keeps the text in memory, and `fetch-licensed.ts` writes only to
gitignored `.expo/grading-audit/`. Delete that folder when done.

Regression net: `lib/__tests__/grading-audit.test.ts`. Real tests hold what works today on every
KJV verse, and fail if any fixture clip outside `scripts/grading-audit/fixtures/say-kjv-misses.json`
scores under 100. Each confirmed bug is a node:test `todo`: it runs, prints as
`✖ ... # known bug, fails until fixed` with its assertion under "failing tests", and never fails
`npm run check`. When a fix lands, remove the test's `todo` option and drop the clips it fixes
from the misses file.

### Where the numbers come from

- **Harness:** synthetic transcripts over every KJV verse and a 263-verse ESV sample. An upper
  bound on exposure, not a rate.
- **Phase B:** 523 computer-voice clips (macOS `say`, 9 voices, 120-260 words a minute) through
  Soniox `stt-async-v5` with the app's own request. The 457 KJV transcripts are the committed
  fixture.
- **One-off Soniox runs:** a real-time run (507 correct KJV recitations), a noisy and fast audio
  run, and a context comparison (batch and real-time, v5 and v6, with and without the verse as
  context). Their scripts and raw transcripts were not kept, so those rates are reported here
  but can't be re-run without new Soniox calls.

No real human voice or phone was used anywhere.

## Ranked

| Rank | Root cause | Real rate (Soniox) | Harness upper bound | Repro |
|---|---|---|---|---|
| 1 | RC1 Spellings compared literally | old spellings changed in 30-60% of verses containing them | 754 + 1,019 + 59 KJV verses | `--pass spelling:`, `--replay`, todos F3 F4 F8 F11 |
| 2 | RC5 ESV verse text carries titles, stanza letters, neighbours | every recitation of an affected verse fails | ~250 ESV verses | `esv-text.ts` |
| 3 | RC2 Thin number grammar | 15 of 111 phase B number clips; v6 prints digits more | 496 KJV verses | `--pass digits:`, todos F2 F10 RC2 |
| 4 | RC3 One-way substitution repair | needs a slip near a compound; not measured on real speech | 3,684 KJV verses | `--pass speech:restart-in-number`, `--pass compound:`, todos F1 F5 F6 RC3 |
| 5 | RC11 Capture edges on a device | not measured | n/a | none: device only |
| 6 | RC4 No sound-alike equivalence | rare with the verse as context | 48,632 harness cases | `--pass homophone:` |
| 7 | RC6 Empty chunk, legacy splitter | every session on an affected passage | 16 ESV omitted verses, 97 one-chapter-book verses | `--check-chunks`, `esv-text.ts`, todos F7 F12 |
| 8 | RC7 API.Bible adapter (NLT, NIV, NKJV) | unknown | n/a | none: no `API_BIBLE_KEY` locally |
| — | RC13 Reader habits: verse numbers, reference, "amen", contractions | not measured | 10,364 multi-verse chunks; 6,799 KJV verses | `--chunk-size 3 --pass reference:verse-numbers`, `--pass reference:`, `--pass contraction:` |
| — | RC10 Soniox lifecycle | 27 audit clips got 429 | n/a | none without Soniox calls |
| — | RC9 Card wording | n/a | 18 of 184 suggested verses | `--card` (John 3:16 below) |
| — | RC8 Pooled score lets wrong sessions pass | n/a | 1,165 of 1,189 chapters | todo RC8 |
| — | RC12 Context echo | 6-7 of 18 similar-sounding swaps | n/a | none without Soniox calls |

RC8 to RC12 aren't "correct recitation graded wrong", but affect the same cards and recordings.
F-numbers are the harness's own finding IDs, used by the todo tests.

## RC1. Spellings compared literally (F3, F4, F8, F11)

- **Real:** old spellings (stedfastly, subtil, builded, Judaea) changed in 30-60% of verses
  containing them, on batch and real-time, v5 and v6. Real-time v5: counsellors→counselors 6 of 6,
  Hearken→harken 3 of 3, shew→show 3 of 12, labour→labor 1 of 7; Saviour, honour and neighbour
  kept every time. Phase B: 30 of 457 clips, for example enquire→inquire 9, vail→veil 5,
  shew→show 4, plus archaic forms said in modern form (ye→you, forgat→forget, builded→built).
  British spellings: rare on batch (3 of 53 phase B clips: fulfil, fulness, "ill favoured").
- **Harness:** `spelling:modern` 754 KJV verses, `spelling:american` 1,019, "Moses's" for
  "Moses'" 59. Unicode variants (soft hyphen, zero-width, U+02BC, U+2010, `&#8217;`) fail
  heavily, but no source sends them today.
- **Card** (real transcript, KJV Ruth 1:18): `...that she was __stedfastly__ ~~steadfastly~~ minded
  to go with her...` 89%.
- **Cause:** `normalize` in `lib/align.ts` compares letters literally. Archaic forms (ye, mine,
  forgat) are different words, not spellings, so a spelling map won't cover them (D1).
- **Repro:** `npm run audit:grading -- --pass spelling:`; `--replay
  scripts/grading-audit/fixtures/say-kjv.json`; todos F3, F4, F8, F11.
- **Suggested fix (A1):** in `lib/align.ts`, strip invisible characters and split on ellipsis and
  slash in `tokenize`; in `normalize`, NFKD with an accent fold (D4), `s's` → `s'`, a wider
  apostrophe and hyphen set; a British, archaic-spelling and name-spelling map applied when
  building comparison units. Prototyped with 0 false pairs. Ride along (A5): add `uhm`, `erm`,
  `mm-hmm`, `uh-huh` and similar to `FILLERS` (todo F9), keeping `ah` and `er`, which are KJV words.

## RC5. ESV verse text poisoned at the adapter and in the shared `verse_cache`

- **Real:** deterministic, run live through the local `bible` function from a fresh cache: a
  reader saying the verse exactly as an ESV Bible prints it scores Psalm 46:1 48%, Psalm 51:1 49%,
  Psalm 23:1 69%, Psalm 119:105 93%. `fetchVerse` in `supabase/functions/bible/adapters/esv.ts`
  asks Crossway for the passage without verse numbers, and the reply includes the psalm title or
  the Psalm 119 stanza letter. The card shows every title word underlined as missing before a
  correct verse.
- **Omitted verses:** a single-verse fetch of Matthew 18:11 or Mark 9:44 returns the two
  neighbouring verses, which are then cached under the omitted number.
- **One-chapter books:** `fetchChapter` sends `Jude 1`, which Crossway reads as verse 1. Jude
  1:24-25 returns no verses; Philemon 1:1-7 returns verse 1 only (RC6).
- **The chapter path** appends the next stanza letter, Song of Solomon speaker labels and
  manuscript notes to the end of the previous verse (90-97%).
- **Cache history decides:** the single-verse path writes into the shared `verse_cache`, and the
  curated catalog and Verse of the Month read Psalm 46:1 and Psalm 119:105 through it, so every ESV
  user is graded against the title until a chapter or range fetch overwrites the row. Run
  `esv-text.ts` twice and the second run scores 100 from the now-clean cache.
- **Exposure:** about 116 titled Psalm verse 1s, 22 stanza starts, 16 omitted verses, 97 verses in
  one-chapter books.
- **Repro:** `npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts` (needs the local
  `ESV_API_KEY`; Crossway's key is free). The harness can't see this: its ESV sample includes
  Psalm 46:1 and Psalm 119:105 as fetched, title and letter included, and every pass builds its
  transcript from that text.
- **Suggested fix (B1, B2):** `fetchVerse` builds a single verse from the numbered parse
  (`include-verse-numbers=true`, the text after `[n]` only, empty when absent and not cached);
  `fetchChapter` asks for `<book> 1:1-<count>` in one-chapter books; `parseChapter` strips stanza
  letters, speaker labels and bracketed notes; `bible/index.ts` never returns `text` with
  `verses: {}`. Ship with a migration that empties the ESV rows of `verse_cache` (D13).

## RC2. Thin number grammar (F2, F10)

- **Real:** batch v5 printed digits on 20 of 111 phase B number clips, and 15 scored 58-88%. The
  context comparison saw 0 of 15 on batch v5 but 5 of 14 on batch v6 and 2 of 6 on real-time v6
  (Numbers 1:46 40%, Revelation 7:4 74%, John 21:11 79%, the same on every retry). Soniox routes v5
  to v6 from 2026-12-15 with no deploy, so this class grows then.
- **Harness:** `digits:all` 496 KJV verses: "an hundred" 226, "threescore" 218, "N thousand and M
  hundred" 69, a span across a comma 1. ESV sample: "a hundred" 2. Soniox kept score words
  ("threescore") as words in 21 of 21 clips, so the 218 are mostly unreal.
- **Card** (real form, KJV Numbers 3:34): `...were __six__ __thousand__ __and__ __two__ __hundred.__
  ~~6,200.~~` 79%.
- **Also false passes:** the greedy parse reads "7,005" as matching "seven thousand and five
  hundred", and "600,003 and 550" as matching most of the 603,550 wording (todo RC2).
- **Not fixable in the aligner:** engine digits with the wrong value (Jeremiah 52:1 "one and
  twenty" printed "120").
- **Repro:** `npm run audit:grading -- --pass digits:`; todos F2, F10, RC2 (two cases).
- **Suggested fix (A2):** extend `parseCardinalWords` and `parseLongestNumber` in `lib/align.ts`:
  article forms ("an hundred"), "N thousand and M hundred", an exact-value check so a greedy "and"
  can't make a wrong number match, digit plus scale word ("600 thousand"), stop a span at a comma.
  Move to v6 deliberately in a release after replaying the fixture on v6 (D11).

## RC3. One-way substitution repair (F1, F5, F6)

- **Real:** the engine mostly copies the verse's "for ever" and "to day" from the context;
  "forever" for "for ever" in 2 of 13 clips. The blow-up needs one slip, stutter or restart near a
  compound or inside a number, which real readers make often; not measured on real speech.
- **Harness:** a compound plus one slip blows up on 3,684 KJV verses; a restart inside a number
  shows the same words struck and underlined on 128 of 823 verses (F1, introduced by 0a63382); a
  split closed compound beside a repeated word 113, a joined one 10.
- **Card** (KJV Hebrews 13:8, one stutter): `Jesus Christ the same yesterday, and __to__ __day,__
  and __for__ __ever.__ ~~today~~ ~~and~~ ~~forever~~` 50%. One slip should cost about 8 points.
- **Cause:** `alignSubstitution` in `lib/align.ts` walks one way and never skips a stray
  transcript word; `diffArrays` anchors on a repeated short word, so split compounds are never
  rejoined.
- **Repro:** `npm run audit:grading -- --pass speech:restart-in-number` and `--pass compound:`;
  todos F1, F5, F6, RC3.
- **Suggested fix (A3):** join compounds before the diff, and rewrite `alignSubstitution` to
  re-diff the region word by word, then greedily skip unmatched transcript words. Prototyped:
  3,684 → 14 verses, F1 128 → 0.

## RC11. Capture edges on a device

- **Real:** not measured; no phone was used. By reading, and one replica:
  - Live-path resampling seams on the built-in mic: `resampleAudioBuffer` in
    `node_modules/@siteed/audio-studio/ios/AudioStreamManager.swift` makes a fresh converter per
    tap buffer (seams proven on a replica, effect on transcripts unknown).
  - Last word lost: a trailing PCM chunk arriving more than `FLUSH_GRACE_MS` after `finish()` in
    `lib/transcription/live-session.ts` is sent after end-of-audio.
  - First word lost when the reader speaks before native capture starts.
  - Route changes and interruptions (`handleRouteChange`, `handleAudioSessionInterruption`) leave
    gaps while the pill still shows.
- **Card** (by reading): "Jesus wept." with the last word clipped → `Jesus __wept.__` 50%.
- **Withdrawn:** phase B lost the first word on 18 of 457 clips, but those clips start speaking at
  sample 0; with a 300 ms lead-in, 0 of 397 lost it. A `say` artifact, not an engine trait.
- **Repro:** none locally. Each needs a device: compare live and batch transcripts of one take,
  log the tap's frame length, time tap-to-first-PCM.

## RC4. No sound-alike equivalence

- **Real:** rare with the verse sent as context: Son/sun, reign, holy/wholly, altar, prey and sow
  all came back right; "lo"→"low" on v6 in 3 of 4 (KJV Matthew 3:17 89%). Without context, 3-4
  per run. Phase B: 0 in 31 at-risk KJV clips and 57 ESV clips.
- **Harness:** 65 homophone passes, 48,632 KJV cases under 100.
- **Card:** KJV Matthew 3:17: `And __lo__ ~~low~~ a voice from heaven...` 89%.
- **Repro:** `npm run audit:grading -- --pass homophone:`.
- **Suggested fix (A4):** a reviewed sound-alike list (true homophones only; "the" for "thee" stays
  wrong) consulted inside the substitution repair (D3). Depends on A3.

## RC6. Empty chunk for an omitted verse; legacy splitter (F7, F12)

- **Real:** deterministic. A passage containing an ESV-omitted verse (Matthew 17:21, 18:11,
  23:14, Mark 7:16, 9:44, 9:46, 11:26, 15:28, Luke 17:36, 23:17, John 5:4, Acts 8:37, 15:34, 24:7,
  28:29, Romans 16:24) gets an empty chunk; `process-recording` answers 400 "Missing actualVerse",
  so the session can't finish, but X saves a partial that can mark Hard complete. A range returned
  with `verses: {}` (a one-chapter book, or a race between `getCachedVerseRange` and
  `getCachedVerseRangeKeyed`) falls to the sentence splitter: KJV John 1:1-14 per verse scores
  100, 47, 31, 16, 4...
- **Harness:** keyed chunking clean on 393,606 chunks; the fallback splitter loses words in 1,763
  of 5,924 runs and misattributes 1,126 of 1,189 chapters.
- **Repro:** `npm run audit:grading -- --check-chunks`; todos F7, F12; `esv-text.ts` for the
  one-chapter books.
- **Suggested fix (B4, B5):** `parseVerseIntoChunks` skips verse numbers absent from
  `verse.verses`; adding a single omitted verse in a translation that lacks it is refused;
  `getVerseText` treats `verses: {}` on a range as a failed fetch, so the splitter never runs.

## RC7. API.Bible adapter (NLT, NIV, NKJV)

- **By reading, unconfirmed, no repro:** `cleanText` in `supabase/functions/bible/adapters/apibible.ts`
  deletes tags without leaving a space, so poetry lines glue ("shepherd;I"); entities aren't
  decoded (`&#8217;`); the `data-number="(\d+)"` pattern misses merged verse numbers like "3-4".
  Running the adapter against stubbed HTML shaped like API.Bible's shows each, but the real output
  was never fetched.
- **Why no repro:** there's no `API_BIBLE_KEY` locally. `supabase/.env.example` names
  `NLT_API_KEY`, while the adapter reads `API_BIBLE_KEY`. A free key would let
  `fetch-licensed.ts NLT` and the harness run on real text.
- **Suggested fix (B3):** replace each tag with a space, decode entities, accept
  `\d+(-\d+)?` and key both numbers, fix `.env.example`.

## RC13. Reader habits graded as mistakes

Not engine errors: the reader says something the verse doesn't have. Today each costs points, by
design. Whether to forgive them is D8 and D18.

- **Verse numbers said aloud** (Easy shows a superscript number on each verse's first word): every
  multi-verse chunk fails, 10,364 of 10,364 KJV chunks at chunk size 3, mostly 90-99%. Card: KJV
  Genesis 1:1-3 said "1 In the beginning... 2 And the earth... 3 And God said..." → 94%, added
  `1 2 3`. Repro: `npm run audit:grading -- --chunk-size 3 --pass reference:verse-numbers`.
- **The reference said before or after:** every verse fails. Card: `~~genesis~~ ~~1:1.~~ In the
  beginning God created the heaven and the earth.` 83%. Repro: `--pass reference:`.
- **A trailing "amen":** `Jesus wept. ~~amen.~~` 67%.
- **Contractions:** "I'll" for "I will", "it's" for "it is", "let's" for "let us": 6,799 KJV
  verses, every one under 100 (4,239 under 90); 85 of the ESV sample. The other direction (a
  translation's "don't" said "do not") checked 0 verses: neither KJV nor the ESV sample has
  contractions, and NLT, which uses them, couldn't be fetched (RC7). Repro:
  `npm run audit:grading -- --pass contraction:`.
- **Suggested fix (A6, decision-gated):** strip a leading or trailing spoken reference equal to the
  chunk's own, verse numbers matching the chunk's verses, and a trailing "amen" when the verse
  lacks one. Contractions: an equivalence list in `normalize`, if D18 says yes.

## RC10. Soniox lifecycle

Not grading, but it fails recordings.

- **No delete:** `transcribeWithSoniox` in `supabase/functions/process-recording/index.ts` never
  deletes the upload or the transcription. Soniox caps an organization at 1,000 files and 2,000
  transcriptions and auto-deletes after 30 days, so at about 33 batch recordings a day every batch
  recording fails.
- **No 429 back-off:** a 429 on job create or status poll throws; the function answers "Processing
  failed", `processRecording` in `lib/api/recording.ts` throws, and `hooks/use-recording.ts` shows
  "Recording failed". The limit is per organization; 27 audit clips got 429 while two audit runs
  were calling at once. Whether the local key shares prod's organization is unknown.
- **Dates:** v5 models removed 2026-12-15 (routed to v6, RC2 grows); `api_key` in the websocket
  start frame refused after 2027-01-15 (old builds fall to batch).
- **Repro:** none without Soniox calls; the code above shows the missing delete and retry.
- **Suggested fix (C1-C4):** delete the transcription and file in a `finally`; retry 429 with
  jitter inside the deadline and return a specific "busy" error; send the key as a websocket
  subprotocol in `lib/transcription/live-session.ts`; move both model strings to v6 in a release.
  Use a separate Soniox organization for audits and local dev (D16).

## RC9. Card wording

- "Perfect!" at 90-99% with visible mistakes (`STATUS_CONFIG` in `components/study/ResultCard.tsx`);
  "Extra: wasn't in the verse" for a word that is in the verse but was said elsewhere; no hint that
  the reader may know another translation; "Hard passed" when the review didn't count. This is
  the part of the review story the aligner can't fix (below).
- **Repro:** the John 3:16 reorder card below; 18 of 184 Bread-suggested verses show a run of 2+
  identical struck and underlined words when said in KJV order against ESV.
- **Suggested fix (E1, E2):** "Perfect!" only at 100 (D14); mark a word struck and underlined in
  the same card as "moved"; when a chunk fails with 3+ substitutions, suggest checking the
  translation in Settings (D10). No scoring change.

## RC8. Pooled session score lets wrong sessions pass

- KJV Psalm 23:1-6, Hard, one verse per chunk, verse 1 never said or revealed: final 92, "Hard
  passed", a review counts. This contradicts the 2026-06-06 decision in
  `docs/features/study-session.md` that a peeked Hard session can't reach 90. Whole-chapter
  sessions survive a silent verse in 1,165 of 1,189 chapters. An empty transcript is graded as a
  real 0% that locks the chunk.
- **Repro:** todo RC8.
- **Suggested fix (D-1 to D-4):** a session counts as passed only with no peeked chunk and every
  chunk at or above a floor (D6, knob `MIN_CHUNK_SCORE`); an early exit never sets `completed`; an
  empty transcript means "nothing heard, record again" (D15). `calculateFinalScore` unchanged.

## RC12. Context echo

- Sending the verse as Soniox context (`context` in `transcribeWithSoniox` and in
  `lib/transcription/live-session.ts`) makes some wrong words come back as the verse's word: a
  similar-sounding swap 7 of 18 (batch v5), 6 of 18 (v6); a modern word for an archaic one 3 of 15
  (v5), 6 of 15 (v6); 0 of 108 for omitted words, unrelated swaps, skipped clauses, reorders and
  paraphrase. Without context, correct recitations fail far more (real-time v6: 21 of 30 under 100).
- **Repro:** none without Soniox calls.
- **Decision:** keep the context (D12).

## Matches the review's story

The App Store review, paraphrased: the second verse was recited perfectly, yet the words said
were crossed out and the same words listed again as missing, the same on 3-4 retries at
different paces. Phones at the time ran 1.3.0, whose aligner is the one before 0a63382. 1.3.0's
card colours match the reviewer's reading (struck = said, underlined = missing); 1.2.0's are the
other way round.

**On 1.3.0, no real transcript of a correct recitation showed identical words struck and
underlined.** Over 1,453 real Soniox transcripts, the 1.3.0 aligner showed one look-alike pair (an
ESV "2,172" against "2172", 67%) and no run of 2+. Every engine formatting variation (apostrophes,
hyphens, dashes, quotes, case, `LORD`) gives 0 look-alike pairs on 1.3.0.

1. **Leading explanation: the right words in a different order.** A transposition shows the moved
   phrase struck where the reader said it and underlined where the verse has it, on every build,
   identically on every retry at any pace. The likeliest source is a translation that shares the
   ESV's words but orders clauses differently (ESV is the account default), or the reader's own
   habit. Card (KJV John 3:16, "he gave" said after "Son", 1.3.0 and today):
   `...that __he__ __gave__ his only begotten Son, ~~he~~ ~~gave,~~ that whosoever...` 85%
   (`npm run audit:grading -- --card --ref "John 3:16" --transcript "For God so loved the world, that his only begotten Son he gave, that whosoever believeth in him should not perish, but have everlasting life." --aligner .expo/grading-audit/old-align.ts`).
   Not an aligner bug; RC9.
2. **Digits on 1.3.0**, fixed for standard forms by 0a63382: KJV Matthew 18:22 → `Until __seventy__
   ~~70~~ times __seven.__ ~~7.~~` 70% on 1.3.0, 100% today
   (`npm run audit:grading -- --card --ref "Matthew 18:22" --transcript "Jesus saith unto him, I say not unto thee, Until 7 times: but, Until 70 times 7." --aligner .expo/grading-audit/old-align.ts`).
   Only if the verse had a number; Soniox printed digits for Matthew 18:22 in 0 of 8 clips with
   the app's context. Low prior.
3. **1.2.0 apostrophe and hyphen desync** (before 041aa49): literally the same word struck then
   underlined, one word per apostrophe, never a run, inverted colours. Low prior.
4. **Spellings** (RC1): `__Judaea__ ~~judea~~` on KJV Matthew 2:1, 93%. One word, usually 89-96%.
5. **Today only, synthetic:** a restart inside a number (F1) and a slip beside a compound (RC3).
   0 real clips on 1.3.0.

**Rejected:** a different translation's vocabulary alone. The card would show visibly different
words (`__your__ ~~thine~~`) beside any identical pairs, which the review doesn't describe.

A retry repeats the card: the card is a pure function of the transcript, and Soniox gave the same
transcript on 34 of 35 reruns of the same audio. To confirm the story: ask the reviewer the verse
and translation in a developer reply, or have Caelan read `session_attempts` for an account
around the review date with 3-4 attempts at 60-89%.

## Decisions for Caelan

Each with the audit's recommended answer.

- **D1** Half credit (`close`) for archaic and modern forms (hath/has, spake/spoke)? Not now; they
  are different words, and E2 tells the reader why.
- **D2** Borderline spellings (hungred, nought/naught, bason, jubile, Juda/Judah)? Include all but
  Sion/Zion and altogether/"all together".
- **D3** Sound-alike borderline groups? wh- pairs, dew/due/do, hour/our in; the/thee, are/our,
  wroth/wrath out.
- **D4** Fold accents on both sides (rosé = rose)? Yes.
- **D5** Accept "six six six" for 666, or "60" for "threescore"? No; it would break the "72 ≠ 7 2"
  guard, and Soniox keeps score words as words.
- **D6** A per-chunk floor for a pass? No peeked chunk, every chunk ≥ 50, session ≥ 90.
- **D7** Peek taint across sessions? Defer; correct the doc claim to "within a session".
- **D8** Strip a spoken reference, verse numbers and a trailing "amen"? Yes (RC13).
- **D9** Collapse an exact restart? No; keep the 2026-08-25 decision. With A3 a restart costs only
  the repeated words.
- **D10** Tell readers their wording looks like another translation? Yes.
- **D11** Move to v6 now or let Soniox switch on 2026-12-15? Deliberately, in a release before,
  after replaying the fixture on v6.
- **D12** Keep sending the verse as context? Yes.
- **D13** Purge all ESV `verse_cache` rows, or only poisoned ones? All, in the B1 release.
- **D14** "Perfect!" at 90-99 → "Passed"? Yes.
- **D15** Empty transcript: a 0% attempt, or "nothing heard, try again"? Try again, nothing saved.
- **D16** A separate Soniox organization for audits and local dev? Yes.
- **D17** Ship A1-A3 as one PR or three? Three on one branch, one release, so readers see one
  score change.
- **D18** Treat a contraction and its full form as equal? Yes both ways: same words, blurred in fast
  speech, and NLT prints contractions. The cost is that "I'll" passes for "I will".

## Checked and clean

- Keyed chunking at sizes 1, 2, 3, 5 and all, three difficulties: every word once, in order; masks
  right (393,606 chunks).
- 0 KJV verses under 100 for: plain, engine-style punctuation and capitals, curly quotes either
  side, a dropped possessive apostrophe, hyphen joins and splits, em and en dashes, NBSP, BOM,
  um/uh/hmm, standard digits.
- ESV sample (263 verses from `fetch-licensed.ts`): plain, engine style, spelling, compound and
  possessive passes clean, digits fail only on "a hundred" (2, RC2). Two of the 263, Psalm 46:1 and
  Psalm 119:105, came from the single-verse path with the title or stanza letter in the text (RC5),
  so the harness graded them against the wrong text and called them clean; `esv-text.ts` shows
  them at 48% and 93%. Characters: only standard ones plus ’ ‘ “ ” —.
- KJV bundle: all 31,102 verses present, pure ASCII, no titles or stanza letters.
- Real-time finishing: the last word never went missing on a fast finish in the Soniox run.

## Phase B

514 clips kept (457 KJV in `scripts/grading-audit/fixtures/say-kjv.json`, 57 ESV kept local), 9
voices at 120-260 words a minute, batch `stt-async-v5` with the app's request. Stopped at Soniox's
per-organization rate limit (27 skipped on 429, 9 empty transcripts dropped as not run). Current
aligner: 88 of 457 KJV under 100 (spelling and archaic forms 30, digits 15, first word dropped 18
(a `say` artifact, RC11), names 7, other mishearings 18), 0 of 57 ESV. Same-word pairs on the KJV
clips: current 2, 1.3.0 10, 1.2.0 11. A merged prototype of A1-A4 takes the 88 to 52, with no
clip lower.

## Not covered

- Real human voices, accents, children, noise on real microphones; no phone was used.
- NIV, NLT and NKJV text (no `API_BIBLE_KEY`); ESV is a 263-verse sample plus the `esv-text.ts`
  cases.
- Contractions in a translation that prints them (NLT), said in full.
- Prod `verse_cache`: how many poisoned ESV rows are live.
- Whether the local Soniox key shares prod's organization.
- Long multi-verse chunks through Soniox.
- The 9 phase B clips with an empty transcript: `say` writing an empty file, or Soniox returning
  nothing. If Soniox, RC8 grades it as a real 0%.
- A v6 replay of the 457-clip fixture before 2026-12-15.
- The reviewer's verse, translation and build.

## Decisions

- The harness is a dev tool in `scripts/grading-audit/`, run by `tsx`, not app code in `lib/` ·
  Only the regression test lives in `lib/__tests__/`.
- "Same word missing and added" is judged by the app's own matcher, plus a visual key (lowercase,
  no punctuation or invisible characters) for words that only look the same · Both are what a
  reader could call "the same word".
- Known bugs are node:test `todo` cases · They run and print without failing `npm run check`;
  removing `todo` turns one into a guard once its fix lands.
- The fixture test pins the set of failing clips, not a count · A change that fixes ten clips and
  breaks ten others must fail.
