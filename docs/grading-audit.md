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
| `npm run audit:grading -- --pass <prefix>` | Passes whose name starts with the prefix (`source:`, `digits:`, `spelling:`, `compound:`, `homophone:`, `contraction:`, `unicode:`, `speech:`, `reference:`, `live:`) |
| `npm run audit:grading -- --chunk-size 3` | Multi-verse chunks. `reference:verse-numbers-in-chunk` checks nothing at the default size 1 |
| `npm run audit:grading -- --check-chunks` | Chunk building at sizes 1, 2, 3, 5 and all, three difficulties, keyed and fallback |
| `npm run audit:grading -- --replay scripts/grading-audit/fixtures/say-kjv.json` | Replays 457 real Soniox transcripts of computer-voice KJV recitations |
| `npm run audit:grading -- --replay .expo/grading-audit/voice-NIV.json [--as-printed]` | Replays a licensed voice round, graded against the served text or, with `--as-printed`, the printed text |
| `npm run audit:grading -- --card --ref "<ref>" --transcript "<text>"` | One result card: `__word__` missing (underlined amber), `~~word~~` added (struck red) |
| `npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts` | ESV verse text from the local `bible` function, checked against the chapter path (RC5) |
| `npx tsx scripts/grading-audit/fetch-licensed.ts ESV --chapters all` | Fetches every ESV chapter (or `NIV`, `NLT`, `NKJV` with the default 270-chapter sample) into gitignored `.expo/grading-audit/` for `--source`. Spends API calls under hard caps; see the file header |
| `npx tsx scripts/grading-audit/text-scan.ts NIV` | What the fetched text holds that grading trips on: missing and merged verses, glue, labels, notes, characters, contractions, digits |
| `npx tsx scripts/grading-audit/voice.ts` | Records computer-voice clips and sends them to Soniox (costs Soniox usage; see the file header). `run --version NIV` is the 150-clip licensed round |

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

- **Harness:** synthetic transcripts over every KJV verse, every ESV chapter (1,189 chapters, 31,090 verses) and a
  270-chapter sample of NIV, NLT and NKJV (about 7,400 verses each: every book's first chapter, the
  suggested passages, chapters with titles, stanzas, omitted verses and numbers, and a spread).
  An upper bound on exposure, not a rate, except `source:as-printed`, which is what a correct
  reader of that translation scores.
- **Phase B:** 523 computer-voice clips (macOS `say`, 9 voices, 120-260 words a minute) through
  Soniox `stt-async-v5` with the app's own request, plus a licensed round of up to 150 clips per
  translation (ESV, NIV, NLT, NKJV), each with 300 ms of silence first. The 457 KJV transcripts are
  the committed fixture; licensed transcripts stay in gitignored `.expo/grading-audit/`.
- **One-off Soniox runs:** a real-time run (507 correct KJV recitations), a noisy and fast audio
  run, and a context comparison (batch and real-time, v5 and v6, with and without the verse as
  context). Their scripts and raw transcripts were not kept, so those rates are reported here
  but can't be re-run without new Soniox calls.

No real human voice or phone was used anywhere.

## Ranked

| Rank | Root cause | Real rate (Soniox) | Harness upper bound | Repro |
|---|---|---|---|---|
| 1 | RC7 API.Bible text glued at every tag (NIV, NLT, NKJV) | 41 NIV, 38 NLT, 38 NKJV of 150 voice clips under 100 (about 25-30 of each from the glue) | 2,054 NIV, 1,897 NLT, 1,921 NKJV of ~7,400 sample verses each | `text-scan.ts`, `--source NIV --pass source:`, todo RC7 |
| 2 | RC1 Spellings compared literally | old spellings changed in 30-60% of verses containing them | 754 + 1,019 + 59 KJV verses | `--pass spelling:`, `--replay`, todos F3 F4 F8 F11 |
| 3 | RC5 ESV verse text carries titles, stanza letters, neighbours | every recitation of an affected verse fails | by chapter 43 of 31,090 ESV verses (4 under 90); by single verse 5 of 5 titled Psalm 1s tried at 48-69%, 3 omitted verses returning neighbours | `esv-text.ts`, `--source ESV --pass source:` |
| 4 | RC2 Thin number grammar | 15 of 111 phase B number clips; v6 prints digits more | 496 KJV verses | `--pass digits:`, todos F2 F10 RC2 |
| 5 | RC3 One-way substitution repair | needs a slip near a compound; not measured on real speech | 3,684 KJV verses | `--pass speech:restart-in-number`, `--pass compound:`, todos F1 F5 F6 RC3 |
| 6 | RC11 Capture edges on a device | not measured | n/a | none: device only |
| 7 | RC4 No sound-alike equivalence | rare with the verse as context | 48,632 harness cases | `--pass homophone:` |
| 8 | RC6 Empty chunk, legacy splitter | every session on an affected passage | 16 omitted verses (ESV, NIV, NLT), 97 one-chapter-book verses (ESV) | `--check-chunks`, `esv-text.ts`, todos F7 F12 |
| 9 | RC14 Fractions printed in the verse (NLT) | not measured (no fraction verse in the voice round) | 42 NLT sample verses | `--source NLT --pass digits:spoken-words`, todo RC14 |
| — | RC13 Reader habits: verse numbers, reference, "amen", contractions | not measured | 10,364 multi-verse chunks; 6,799 KJV verses; 584 NLT verses said without contractions | `--chunk-size 3 --pass reference:verse-numbers`, `--pass reference:`, `--pass contraction:` |
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
- **The chapter path** appends the next stanza name, Song of Solomon speaker labels and
  manuscript notes to the end of the previous verse. Over the whole ESV by chapter: 43 verses read
  as printed score under 100 (21 Psalm 119 stanza names, about 20 speaker labels, 2 notes), 4 of
  them under 90. Every chapter of a one-chapter book fails; only single-verse fetches return them.
- **Past the last verse:** a single-verse fetch one past the end of Obadiah, Philemon, 2 John and
  Jude returns the last verse again. The app doesn't ask for those today.
- **Cache history decides:** the single-verse path writes into the shared `verse_cache`, and the
  curated catalog and Verse of the Month read Psalm 46:1 and Psalm 119:105 through it, so every ESV
  user is graded against the title until a chapter or range fetch overwrites the row. Run
  `esv-text.ts` twice and the second run scores 100 from the now-clean cache.
- **Exposure:** about 116 titled Psalm verse 1s and 22 stanza starts on the single path (Psalm 3:1
  52%, 23:1 69%, 46:1 48%, 51:1 49%, 90:1 56%, 119:1 94%, 119:105 93%, Song of Solomon 1:2 94%);
  17 omitted verses, of which Matthew 18:11, Mark 9:44 and Acts 8:37 return 50-68 words of
  neighbours; 97 verses in one-chapter books.
- **Repro:** `npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts` (needs the local
  `ESV_API_KEY`; Crossway's key is free). The harness sees only the chapter path
  (`--source ESV --pass source:as-printed`); `fetch-licensed.ts` also saves the single-verse
  list to `ESV-single.json`.
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
  hundred" 69, a span across a comma 1. Soniox kept score words ("threescore") as words in 21 of
  21 clips, so the 218 are mostly unreal. Licensed text, read as printed: "a hundred" fails in
  96 ESV verses (49 under 90), 43 NIV, 9 NLT and 12 NKJV sample verses.
- **Digits in the verse, said as words:** ESV, NIV and NLT print large numbers as digits ("2,172"),
  in 575 ESV verses, 300 NIV and 374 NLT sample verses. Said in words, every one
  passes once the RC7 glue is undone (`--pass digits:spoken-words`), except NLT's fractions (RC14).
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

## RC14. Fractions printed in the verse (NLT)

- **Harness:** NLT prints measures as mixed numbers ("3-1/4", "1-1/2"), in 42 of its 7,378 sample
  verses (Exodus, Numbers 7, Ezekiel 40-48). A reader saying them in words fails every one: made-up
  text `it weighed __3-1/4__ ~~three~~ ~~and~~ ~~one~~ ~~fourth~~ pounds.` 38%; an engine printing
  "3 1/4" gets 50%. NIV, NKJV and ESV write fractions in words. Real: not measured; the NLT voice round drew no fraction verse.
- **Cause:** the number grammar in `lib/align.ts` has no fractions, and `tokenize` keeps "3-1/4" as
  one word.
- **Repro:** `npm run audit:grading -- --source NLT --pass digits:spoken-words`; todo RC14.
- **Suggested fix (with A2):** read "N-a/b" as a number in `parseLongestNumber`, matched by "N and
  a b-ths" (one fourth, a quarter, a half, three quarters) and by "N a/b".

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

## RC7. API.Bible chapter text glued at every tag (NIV, NLT, NKJV)

- **Real:** a 270-chapter sample of each translation through the local `bible` function (7,425
  NIV, 7,378 NLT and 7,441 NKJV verses). A reader saying each verse exactly as the printed Bible
  has it scores under 100 on 2,054 NIV verses (28%), 1,897 NLT (26%) and 1,921 NKJV (26%), and
  under 90 on 1,929, 1,807 and 1,859. Whole-chapter sessions read perfectly fail 199 of 286 NIV,
  189 of 291 NLT and 167 of 270 NKJV chapter runs. Computer-voice clips through Soniox with the
  app's request: 41 of 150 NIV, 38 of 150 NLT and 38 of 150 NKJV clips score under
  100 against the served text; against the printed text, 16, 14 and 16, and most of those are the
  glue again (below).
- **Glue:** `cleanText` in `supabase/functions/bible/adapters/apibible.ts` deletes HTML tags
  without leaving a space, so every poetry line, paragraph and quotation break glues two words
  (`shepherd;I`, `said,“Let`). 1,914 NIV, 1,772 NLT and 1,812 NKJV sample verses hold one; a
  further 70-130 per translation glue two words with no punctuation between (a heuristic count),
  which no pass can repair.
- **Card** (KJV words, glued the way the adapter serves NIV, NLT and NKJV, on 1.3.0 and today):
  `The LORD is my __shepherd;I__ ~~shepherd,~~ ~~i~~ shall not want.` 70%. The reader's own two
  words show struck beside the glued pair, on every retry, at any pace (see the review's story).
- **Stanza labels:** NIV and NKJV append the next Psalm 119 stanza letter and its name to the last
  verse of each stanza (21 of 21).
- **Merged verse numbers:** NLT prints Numbers 1:20-46 and 2:3-31 as rows numbered "20-21". The
  `data-number="(\d+)"` pattern misses them, so 48 verses are absent and their text, labels glued
  in, lands in the verse before: Numbers 1:19 holds the text of 1:20-46, and those verses can't
  be added.
- **Dropped verse:** NIV Habakkuk 3:1 is formatted as a heading and is absent from the chapter.
- **Notes:** NIV and NLT append the bracketed manuscript note to Mark 16:8 and John 7:52.
- **Single-verse path** (`fetchVerse`, plain text, no glue): NIV puts "Psalm N" before every psalm's
  verse 1 (Psalm 3:1 86%, 23:1 80%, 46:1 85%, 51:1 91%, 90:1 83%), and all three put the stanza
  letter before Psalm 119:1 (NIV 84%, NLT 92%, NKJV 94%). NIV and NLT answer 404 for an omitted
  verse, so adding one alone shows an error.
- **Context:** the glued text is also the Soniox context, and Soniox copied the glue into
  9 NIV, 6 NLT and 9 NKJV of those transcripts, which then match by accident.
- **Repro:** `npx tsx scripts/grading-audit/fetch-licensed.ts NIV` (spends API.Bible calls), then
  `npx tsx scripts/grading-audit/text-scan.ts NIV` and `npm run audit:grading -- --source NIV --pass
  source:as-printed`; todo RC7 with KJV words.
- **Suggested fix (B3):** in `cleanText` and `parseChapterContent`, turn block tags into a space,
  drop stanza-label and note elements, accept `\d+(-\d+)?` and key both numbers, keep a verse that
  sits in a heading element, and strip the "Psalm N" heading on the single-verse path. Ride along
  (A1): `tokenize` in `lib/align.ts` splits a word on punctuation between two letters, because prod's
  `verse_cache` keeps the glued rows until they are purged (D19). Fix `.env.example` (it names
  `NLT_API_KEY`; the adapter reads `API_BIBLE_KEY`).

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
  verses, every one under 100 (4,239 under 90), and 9,147 ESV verses (6,340 under 90). The other direction, a
  translation's "don't" said "do not": NLT prints contractions in 597 of its 7,378 sample verses
  (mostly "don't", "won't", "didn't", "can't") and NIV in 85; said in full, every one fails (NLT
  584 of 584 checked, 391 under 90; NIV 85 of 85). ESV and NKJV print none. Repro:
  `npm run audit:grading -- --pass contraction:` (add `--source NLT` for the second).
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

**For NIV, NLT and NKJV readers, reproduced on 1.3.0 with real transcripts.** The RC7 glue shows
exactly this: a correct recitation, the reader's words struck, the same words underlined as one
glued word, identically on every retry at any pace, on every build (the glue is server-side).
Computer-voice clips through Soniox, graded by the 1.3.0 aligner: 36 of 150 NIV, 33 of 150
NLT and 32 of 150 NKJV correct recitations show 2 or more of the reader's words both struck and
underlined (the current aligner: the same counts). About a quarter of all verses in those translations carry a glue point, and
poetry (Psalms, Proverbs) far more. Card on 1.3.0 (KJV words, glued as served):
`The LORD is my __shepherd;I__ ~~shepherd,~~ ~~i~~ shall not want.` 70%
(`npm run audit:grading -- --card --expected "The LORD is my shepherd;I shall not want." --transcript "The Lord is my shepherd, I shall not want." --aligner .expo/grading-audit/old-align.ts`).
This becomes the leading explanation if the reviewer's account was on NIV, NLT or NKJV.

**For KJV and ESV readers, no real transcript of a correct recitation showed it on 1.3.0.** Over
1,453 real Soniox transcripts before this round, the 1.3.0 aligner showed one look-alike pair (an
ESV "2,172" against "2172", 67%) and no run of 2+. The 150 ESV voice clips agree: 9 under 100 today and 10 on 1.3.0, none with a run of 2+. Every engine formatting variation
(apostrophes, hyphens, dashes, quotes, case, `LORD`) gives 0 look-alike pairs on 1.3.0.

1. **Leading explanation on KJV and ESV: the right words in a different order.** A transposition shows the moved
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
- **D19** Purge the API.Bible rows (NIV, NLT, NKJV) of `verse_cache` in the B3 release, as D13
  does for ESV? Yes, all of them: every glued row stays wrong until something overwrites it.
- **D20** Also split a word on punctuation between letters in the aligner (A1), so text already
  cached or served by an old function still grades right? Yes; cheap, and it guards the next
  adapter bug of this kind.
- **D21** Accept fractions in words ("three and a quarter", "three and one fourth") for NLT's
  "3-1/4" (RC14)? Yes.
- **D22** Ask the reviewer which translation they use? Yes: if NIV, NLT or NKJV, RC7 explains the
  review completely.

## Checked and clean

- Keyed chunking at sizes 1, 2, 3, 5 and all, three difficulties: every word once, in order; masks
  right (393,606 chunks).
- 0 KJV verses under 100 for: plain, engine-style punctuation and capitals, curly quotes either
  side, a dropped possessive apostrophe, hyphen joins and splits, em and en dashes, NBSP, BOM,
  um/uh/hmm, standard digits.
- Full ESV by chapter (31,090 verses): plain 3 under 100, all hyphen compounds (RC3 class:
  Genesis 19:12, Joshua 14:15, 21:11); digits printed in the verse and said as words, 1 (2 Chronicles
  35:7, 80%); no printed contractions, no fractions, no HTML entities; keyed chunking clean at
  every size (392,916 chunks).
- NIV, NLT and NKJV samples, once the RC7 glue is undone (`--source <V>printed`-style check): plain
  and engine-style 0 under 100 in NIV and NKJV, NLT only its fractions (RC14); digits printed in
  the verse and said as words, 0 in NIV; keyed chunking clean at every size. Characters: standard
  punctuation, ’ ‘ “ ” — –, and in NIV and NKJV the 22 Hebrew stanza letters (RC7). No HTML entities
  or leftover tags reach the text.
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

Licensed round: up to 150 clips per translation, half on verses a number, contraction, compound
or possessive pass touches and half a spread, 9 voices at 120-260 words a minute, each clip with
300 ms of silence first. Graded against the served text, then against the printed text
(`--as-printed`), which takes out the adapter's damage (RC5, RC7) and leaves the engine's:

| Translation | Clips | Under 100, served text (under 90) | Same on 1.3.0 | 2+ struck-and-underlined pairs | Under 100, printed text | Glue echo | Voice artifact: garbled fast voice / first word dropped | Engine mishearings |
|---|---|---|---|---|---|---|---|---|
| ESV | 150 | 9 (7) | 10 | 0 | 10 | 0 | 2 / 0 | 7, plus 1 audit artifact (a speaker label read aloud, then removed by `--as-printed`) |
| NIV | 150 | 41 (33) | 44 | 36 | 16 | 9 | 0 / 0 | 7 |
| NLT | 150 | 38 (33) | 39 | 33 | 14 | 6 | 2 / 0 | 6 (3 at the same fast voice) |
| NKJV | 150 | 38 (35) | 44 | 32 | 16 | 9 | 2 / 0 | 5 |

Every garbled clip is one UK voice at 260 words a minute. The silent lead-in stopped `say`
dropping the first word (18 KJV clips in the first round, 0 here). Glue echo is Soniox writing a
glued word back as one ("shepherd;I" heard as "shepherdi"), so it goes away with RC7. Engine
mishearings are single words: a name, a tense, "a hundred" written 100, one spelling
(worshiping), a sound-alike. No contraction, digit or fraction clip failed for that reason, but the
NLT round drew no fraction verse. The ESV clips read chapter text; the single-path titles (RC5)
fail every recitation and needed no clip.

## Not covered

- Real human voices, accents, children, noise on real microphones; no phone was used.
- NIV, NLT and NKJV beyond the 270-chapter sample (about 919 chapters each); the classes found are
  structural, so the rate should hold, but rarer layouts (lists, letters, other merged rows) may
  hide more.
- Prod `verse_cache`: how many poisoned ESV rows and glued API.Bible rows are live.
- Whether the local Soniox key shares prod's organization.
- Long multi-verse chunks through Soniox, and the licensed translations through the real-time path.
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
