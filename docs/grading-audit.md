# Grading audit

Every known way Bread grades a correct recitation wrong, ranked, with the cause, a runnable
repro and a suggested fix, plus things found on the way that fail recordings or let wrong
recitations pass. Fixes follow [Decisions](#decisions), above all the first: a person is
talking, not spelling.

Grading itself is described in `docs/features/study-session.md` (alignment, scoring) and
`docs/features/transcription.md` (the two transcription paths).

## How to run

The harness feeds "correct" recitations through the app's own `parseVerseIntoChunks`,
`alignTranscription` and `calculateChunkScore`, and reports every chunk under 100 and every
chunk where the same word is both missing and added.

| Command | What it does |
|---|---|
| `npx tsx scripts/grading-audit/run.ts` | Every variation pass over all 31,102 bundled KJV verses, one verse per chunk |
| `npx tsx scripts/grading-audit/run.ts --pass <prefix>` | Passes whose name starts with the prefix (`source:`, `digits:`, `spelling:`, `compound:`, `homophone:`, `contraction:`, `unicode:`, `speech:`, `reference:`, `live:`) |
| `npx tsx scripts/grading-audit/run.ts --chunk-size 3` | Multi-verse chunks. `reference:verse-numbers-in-chunk` checks nothing at the default size 1 |
| `npx tsx scripts/grading-audit/run.ts --check-chunks` | Chunk building at sizes 1, 2, 3, 5 and all, three difficulties, keyed and fallback |
| `npx tsx scripts/grading-audit/run.ts --replay scripts/grading-audit/fixtures/say-kjv.json` | Replays 457 real Soniox transcripts of computer-voice KJV recitations |
| `npx tsx scripts/grading-audit/run.ts --replay .expo/grading-audit/voice-NIV.json [--as-printed]` | Replays a licensed voice round, graded against the served text or, with `--as-printed`, the printed text |
| `npx tsx scripts/grading-audit/run.ts --card --ref "<ref>" --transcript "<text>"` | One result card: `__word__` missing (underlined amber), `~~word~~` added (struck red) |
| `npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts` | ESV verse text from the local `bible` function, checked against the chapter path (RC5) |
| `npx tsx scripts/grading-audit/fetch-licensed.ts <V> [--chapters all\|sample\|"Psalms 23"]` | Fetches ESV, NIV, NLT or NKJV by chapter into gitignored `.expo/grading-audit/` for `--source`: every chapter, a 270-chapter sample (default), or named chapters. Spends API calls under hard caps; see the file header |
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
gitignored `.expo/grading-audit/`.

Regression net: `lib/__tests__/grading-audit.test.ts`. Real tests hold what works on every KJV
verse, and fail if any fixture clip outside `scripts/grading-audit/fixtures/say-kjv-misses.json`
scores under 100. Each confirmed bug is a node:test `todo`: it runs, prints as
`✖ ... # known bug, fails until fixed` with its assertion under "failing tests", and never fails
`npm run check`. When a fix lands, remove the test's `todo` option and drop the clips it fixes
from the misses file.

### Where the numbers come from

- **Harness:** synthetic transcripts over every KJV verse, every ESV chapter (31,090 verses
  returned) and a 270-chapter sample of NIV, NLT and NKJV (about 7,400 verses each: every book's
  first chapter, the suggested passages, chapters with titles, stanzas, omitted verses and numbers,
  and a spread). An upper bound on exposure, not a rate, except `source:as-printed`, which is what
  a correct reader of that translation scores.
- **Voice clips:** macOS `say` (9 voices, 120-260 words a minute, 300 ms of silence first) through
  Soniox `stt-async-v5` with the app's own request. The 457 KJV transcripts are the committed
  fixture; 88 score under 100 (spelling and archaic forms 30, digits 15, a first word `say`
  dropped 18, names 7, other mishearings 18). Licensed rounds of 150 clips per translation stay in
  `.expo/grading-audit/`; graded against the printed text (`--as-printed`) they separate the
  adapter's damage (RC5, RC7) from the engine's. One UK voice at 260 words a minute garbled 2 clips
  in each of ESV, NLT and NKJV: a voice artifact.
- **One-off Soniox runs:** a real-time run (507 correct KJV recitations), a noisy and fast audio
  run, and a context comparison (batch and real-time, v5 and v6, with and without the verse as
  context). Their scripts and raw transcripts were not kept, so those rates can't be re-run
  without new Soniox calls.

## Ranked

| Rank | Root cause | Real rate (Soniox) | Harness upper bound | Repro |
|---|---|---|---|---|
| 1 | RC7 API.Bible text glued at every tag (NIV, NLT, NKJV) | 41 NIV, 38 NLT, 38 NKJV of 150 voice clips under 100 (about 25-30 of each from the glue) | 2,054 NIV, 1,897 NLT, 1,921 NKJV of ~7,400 sample verses each | `text-scan.ts`, `--source NIV --pass source:`, todo RC7 |
| 2 | RC1 Spellings compared literally | old spellings changed in 30-60% of verses containing them | 754 + 1,019 + 59 KJV verses | `--pass spelling:`, `--replay`, todos F3 F4 F8 F11 |
| 3 | RC5 ESV verse text carries titles, stanza letters, neighbours | every recitation of an affected verse fails | by chapter 43 ESV verses (4 under 90); by single verse 5 of 5 titled Psalm 1s tried at 48-69%, 3 omitted verses returning neighbours | `esv-text.ts`, `--source ESV --pass source:` |
| 4 | RC2 Thin number grammar | 15 of 111 voice number clips; v6 prints digits more | 496 KJV verses | `--pass digits:`, todos F2 F10 RC2 |
| 5 | RC3 One-way substitution repair | needs a slip near a compound; not measured on real speech | 3,684 KJV verses | `--pass speech:restart-in-number`, `--pass compound:`, todos F1 F5 F6 RC3 |
| 6 | RC11 Capture edges on a device | not measured | n/a | none: device only |
| 7 | RC6 Empty chunk, legacy splitter | every session on an affected passage | 16 ESV-omitted verses, 97 one-chapter-book verses (ESV) | `--check-chunks`, `esv-text.ts`, todos F7 F12 |
| 8 | RC14 Fractions printed in the verse (NLT) | not measured | 42 NLT sample verses | `--source NLT --pass digits:spoken-words`, todo RC14 |
| — | RC4 No sound-alike equivalence (kept, D3) | rare with the verse as context | 48,632 harness cases | `--pass homophone:` |
| — | RC13 Reader habits (kept, D8, D18) | not measured | 10,364 multi-verse chunks; 6,799 KJV verses; 584 NLT verses | `--chunk-size 3 --pass reference:verse-numbers`, `--pass reference:`, `--pass contraction:` |
| — | RC10 Soniox lifecycle | 27 audit clips got 429 | n/a | none without Soniox calls |
| — | RC9 Card wording | n/a | 18 of 184 suggested verses | `--card` (John 3:16 below) |
| — | RC8 Pooled score (kept, D6, D15) | n/a | 1,165 of 1,189 chapters | todo RC8 |
| — | RC12 Context echo (kept, D12) | 6-7 of 18 similar-sounding swaps | n/a | none without Soniox calls |

RC8 to RC12 aren't "correct recitation graded wrong", but affect the same cards and recordings.
F-numbers are the harness's own finding IDs, used by the todo tests.

## RC1. Spellings compared literally (F3, F4, F8, F11)

- **Real:** old spellings (stedfastly, subtil, builded, Judaea) changed in 30-60% of verses
  containing them, on batch and real-time, v5 and v6. Real-time v5: counsellors→counselors 6 of 6,
  Hearken→harken 3 of 3, shew→show 3 of 12, labour→labor 1 of 7; Saviour, honour and neighbour
  kept every time. Voice clips: 30 of 457, for example enquire→inquire 9, vail→veil 5, shew→show 4.
- **Harness:** `spelling:modern` 754 KJV verses, `spelling:american` 1,019, "Moses's" for
  "Moses'" 59. Unicode variants (soft hyphen, zero-width, U+02BC, U+2010, `&#8217;`) fail
  heavily, but no source sends them.
- **Card** (real transcript, KJV Ruth 1:18): `...that she was __stedfastly__ ~~steadfastly~~ minded
  to go with her...` 89%.
- **Cause:** `normalize` in `lib/align.ts` compares letters literally.
- **Repro:** `npx tsx scripts/grading-audit/run.ts --pass spelling:`; `--replay
  scripts/grading-audit/fixtures/say-kjv.json`; todos F3, F4, F8, F11.
- **Suggested fix (A1):** a word that differs from the verse's only in how it is written counts as
  correct, and the card shows the verse's spelling (D2, D4): British and American, archaic
  spellings (stedfastly, shew, subtil), names (Judaea, Sion), accents, apostrophes, hyphens and
  spacing (altogether / "all together"). In `lib/align.ts`: strip invisible characters and split
  on ellipsis and slash in `tokenize`; in `normalize`, NFKD with an accent fold, `s's` → `s'`, a
  wider apostrophe and hyphen set; a spelling map applied when building comparison units. Forms
  that are other words (ye, spake, forgat, builded) stay wrong, with no half credit (D1). Ride
  along: add `uhm`, `erm`, `mm-hmm`, `uh-huh` and similar to `FILLERS` (todo F9), keeping `ah` and
  `er`, which are KJV words.

## RC5. ESV verse text poisoned at the adapter and in the shared `verse_cache`

- **Single verse:** `fetchVerse` in `supabase/functions/bible/adapters/esv.ts` asks Crossway for
  the passage without verse numbers, and the reply includes the psalm title or the Psalm 119
  stanza letter. A reader saying the verse as an ESV Bible prints it scores Psalm 3:1 52%, 23:1
  69%, 46:1 48%, 51:1 49%, 90:1 56%, 119:1 94%, 119:105 93%, Song of Solomon 1:2 94%; the card
  shows every title word underlined as missing. About 116 titled Psalm verse 1s and 22 stanza
  starts are exposed.
- **Omitted verses:** of the 16 (RC6), the three tried (Matthew 18:11, Mark 9:44, Acts 8:37)
  return 50-68 words of the neighbouring verses, cached under the omitted number.
- **One-chapter books:** `fetchChapter` sends `Jude 1`, which Crossway reads as verse 1. Jude
  1:24-25 returns no verses; Philemon 1:1-7 returns verse 1 only (RC6). A single-verse fetch one
  past the end of Obadiah, Philemon, 2 John and Jude returns the last verse again.
- **Chapter path:** appends the next stanza name, Song of Solomon speaker labels and manuscript
  notes to the end of the previous verse: 43 verses read as printed score under 100 (21 stanza
  names, about 20 speaker labels, 2 notes), 4 of them under 90.
- **Cache history decides:** the single-verse path writes into the shared `verse_cache`, and the
  curated catalog and Verse of the Month read Psalm 46:1 and Psalm 119:105 through it, so every ESV
  user is graded against the title until a chapter or range fetch overwrites the row. Run
  `esv-text.ts` twice and the second run scores 100 from the now-clean cache.
- **Repro:** `npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts` (needs the local
  `ESV_API_KEY`). The harness sees only the chapter path (`--source ESV --pass source:as-printed`).
- **Suggested fix (B1, B2):** `fetchVerse` builds a single verse from the numbered parse
  (`include-verse-numbers=true`, the text after `[n]` only, empty when absent and not cached);
  `fetchChapter` asks for `<book> 1:1-<count>` in one-chapter books; `parseChapter` strips stanza
  letters, speaker labels and bracketed notes; `bible/index.ts` never returns `text` with
  `verses: {}`. The same fix clears the ESV rows of `verse_cache` (D13).

## RC2. Thin number grammar (F2, F10)

- **Real:** batch v5 printed digits on 20 of 111 voice number clips, and 15 scored 58-88%. The
  context comparison saw 0 of 15 on batch v5 but 5 of 14 on batch v6 and 2 of 6 on real-time v6
  (Numbers 1:46 40%, Revelation 7:4 74%, John 21:11 79%, the same on every retry). Soniox routes v5
  to v6 from 2026-12-15 with no deploy, so this class grows then.
- **Harness:** `digits:all` 496 KJV verses: "an hundred" 226, "threescore" 218, "N thousand and M
  hundred" 69, a span across a comma 1. Soniox kept score words ("threescore") as words in 21 of
  21 clips, so the 218 are mostly unreal. Licensed text, read as printed: "a hundred" fails in
  96 ESV verses (49 under 90), 43 NIV, 9 NLT and 12 NKJV sample verses.
- **Digits in the verse, said as words:** ESV, NIV and NLT print large numbers as digits ("2,172"),
  in 575 ESV verses, 300 NIV and 374 NLT sample verses. Said in words, every one passes once the
  RC7 glue is undone, except NLT's fractions (RC14).
- **Card** (real form, KJV Numbers 3:34): `...were __six__ __thousand__ __and__ __two__ __hundred.__
  ~~6,200.~~` 79%.
- **Also false passes:** the greedy parse reads "7,005" as matching "seven thousand and five
  hundred", and "600,003 and 550" as matching most of the 603,550 wording (todo RC2).
- **Not fixable in the aligner:** engine digits with the wrong value (Jeremiah 52:1 "one and
  twenty" printed "120").
- **Repro:** `npx tsx scripts/grading-audit/run.ts --pass digits:`; todos F2, F10, RC2 (two cases).
- **Suggested fix (A2):** extend `parseCardinalWords` and `parseLongestNumber` in `lib/align.ts`:
  article forms ("an hundred"), "N thousand and M hundred", an exact-value check so a greedy "and"
  can't make a wrong number match, digit plus scale word ("600 thousand"), stop a span at a comma.
  "six six six" and "60" stay wrong for 666 and threescore (D5). Move both model strings to v6 on
  purpose before 2026-12-15, after replaying the fixture on v6 (D11).

## RC14. Fractions printed in the verse (NLT)

- **Harness:** NLT prints measures as mixed numbers ("3-1/4", "1-1/2"), in 42 of its 7,378 sample
  verses (Exodus, Numbers 7, Ezekiel 40-48). A reader saying them in words fails every one: made-up
  text `it weighed __3-1/4__ ~~three~~ ~~and~~ ~~one~~ ~~fourth~~ pounds.` 38%; an engine printing
  "3 1/4" gets 50%. NIV, NKJV and ESV write fractions in words. Real: not measured.
- **Cause:** the number grammar in `lib/align.ts` has no fractions, and `tokenize` keeps "3-1/4" as
  one word.
- **Repro:** `npx tsx scripts/grading-audit/run.ts --source NLT --pass digits:spoken-words`; todo RC14.
- **Suggested fix (with A2, D21):** read "N-a/b" as a number in `parseLongestNumber`, matched by "N
  and a b-ths" (one fourth, a quarter, a half, three quarters) and by "N a/b".

## RC3. One-way substitution repair (F1, F5, F6)

- **Real:** the engine mostly copies the verse's "for ever" and "to day" from the context;
  "forever" for "for ever" in 2 of 13 clips. The blow-up needs one slip, stutter or restart near a
  compound or inside a number; not measured on real speech.
- **Harness:** a compound plus one slip blows up on 3,684 KJV verses; a restart inside a number
  shows the same words struck and underlined on 128 of 823 verses (F1, introduced by 0a63382); a
  split closed compound beside a repeated word 113, a joined one 10.
- **Card** (KJV Hebrews 13:8, one stutter): `Jesus Christ the same yesterday, and __to__ __day,__
  and __for__ __ever.__ ~~today~~ ~~and~~ ~~forever~~` 50%. One slip should cost about 8 points.
- **Cause:** `alignSubstitution` in `lib/align.ts` walks one way and never skips a stray
  transcript word; `diffArrays` anchors on a repeated short word, so split compounds are never
  rejoined.
- **Repro:** `npx tsx scripts/grading-audit/run.ts --pass speech:restart-in-number` and `--pass compound:`;
  todos F1, F5, F6, RC3.
- **Suggested fix (A3):** join compounds before the diff (spacing is spelling, D2), and rewrite
  `alignSubstitution` to re-diff the region word by word, then greedily skip unmatched transcript
  words. A restart still costs the repeated words (D9).

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
- **Not this:** the 18 voice clips that lost their first word started speaking at sample 0; with a
  300 ms lead-in, 0 of 397 lost it.
- **Repro:** none locally. Each needs a device: compare live and batch transcripts of one take,
  log the tap's frame length, time tap-to-first-PCM.

## RC4. No sound-alike equivalence (kept)

- **Real:** rare with the verse sent as context: Son/sun, reign, holy/wholly, altar, prey and sow
  all came back right; "lo"→"low" on v6 in 3 of 4. Without context, 3-4 per run. Voice clips: 0 in
  31 at-risk KJV clips and 57 ESV clips.
- **Harness:** 65 homophone passes, 48,632 KJV cases under 100.
- **Card:** KJV Matthew 3:17: `And __lo__ ~~low~~ a voice from heaven...` 89%.
- **Repro:** `npx tsx scripts/grading-audit/run.ts --pass homophone:`.
- **No fix:** no sound-alike map (D3).

## RC6. Empty chunk for an omitted verse; legacy splitter (F7, F12)

- **Real:** deterministic. A passage containing one of the 16 verses ESV omits (Matthew 17:21,
  18:11, 23:14, Mark 7:16, 9:44, 9:46, 11:26, 15:28, Luke 17:36, 23:17, John 5:4, Acts 8:37, 15:34,
  24:7, 28:29, Romans 16:24) gets an empty chunk; `process-recording` answers 400 "Missing
  actualVerse", so the session can't finish, but X saves a partial that can mark Hard complete.
  `OMITTED_IN_SOME_TRANSLATIONS` in `lib/store/translation.ts` lists these plus Matthew 12:47. A
  range returned with `verses: {}` (a one-chapter book, or a race between `getCachedVerseRange`
  and `getCachedVerseRangeKeyed`) falls to the sentence splitter: KJV John 1:1-14 per verse scores
  100, 47, 31, 16, 4...
- **Harness:** keyed chunking clean on 393,606 chunks; the fallback splitter loses words in 1,763
  of 5,924 runs and misattributes 1,126 of 1,189 chapters.
- **Repro:** `npx tsx scripts/grading-audit/run.ts --check-chunks`; todos F7, F12; `esv-text.ts` for the
  one-chapter books.
- **Suggested fix (B4, B5):** `parseVerseIntoChunks` skips verse numbers absent from
  `verse.verses`; adding a single omitted verse in a translation that lacks it is refused;
  `getVerseText` treats `verses: {}` on a range as a failed fetch, so the splitter never runs.

## RC7. API.Bible chapter text glued at every tag (NIV, NLT, NKJV)

- **Real:** a 270-chapter sample of each translation through the local `bible` function (7,425
  NIV, 7,378 NLT and 7,441 NKJV verses). A reader saying each verse exactly as printed scores under
  100 on 2,054 NIV verses (28%), 1,897 NLT (26%) and 1,921 NKJV (26%), and under 90 on 1,929, 1,807
  and 1,859. Whole-chapter sessions read perfectly fail 199 of 286 NIV, 189 of 291 NLT and 167 of
  270 NKJV chapter runs. Voice clips: 41, 38 and 38 of 150 under 100 against the served text;
  against the printed text 16, 14 and 16, most of those the glue again (Soniox writes a glued word
  back as one, "shepherdi").
- **Glue:** `cleanText` in `supabase/functions/bible/adapters/apibible.ts` deletes HTML tags
  without leaving a space, so every poetry line, paragraph and quotation break glues two words
  (`shepherd;I`, `said,“Let`). 1,914 NIV, 1,772 NLT and 1,812 NKJV sample verses hold one; a
  further 70-130 per translation glue two words with no punctuation between (a heuristic count).
  The chapter path asks for `content-type: html`; `fetchVerse` asks for text, so the single path
  has no glue.
- **Card** (KJV words, glued the way the adapter serves NIV, NLT and NKJV, on 1.3.0 and current):
  `The LORD is my __shepherd;I__ ~~shepherd,~~ ~~i~~ shall not want.` 70%.
- **Stanza labels:** NIV and NKJV append the next Psalm 119 stanza letter and name to the last
  verse of each stanza (21 of 21).
- **Merged verse numbers:** NLT prints Numbers 1:20-46 and 2:3-31 as rows numbered "20-21". The
  `data-number="(\d+)"` pattern misses them, so 48 verses are absent and their text lands in the
  verse before.
- **Dropped verse:** NIV Habakkuk 3:1 is formatted as a heading and is absent from the chapter.
- **Notes:** NIV and NLT append the bracketed manuscript note to Mark 16:8 and John 7:52.
- **Single-verse path:** NIV puts "Psalm N" before every psalm's verse 1 (Psalm 3:1 86%, 23:1
  80%, 46:1 85%, 51:1 91%, 90:1 83%), and all three put the stanza letter before Psalm 119:1 (NIV
  84%, NLT 92%, NKJV 94%). NIV and NLT answer 404 for an omitted verse.
- **Repro:** todo RC7 with KJV words. With text: `npx tsx scripts/grading-audit/fetch-licensed.ts
  NIV --chapters "Psalms 23"` (one API.Bible call), then `text-scan.ts NIV` and `npx tsx
  scripts/grading-audit/run.ts --source NIV --pass source:as-printed`. The sample counts above can't be
  re-derived cheaply: the sample costs 270 calls per translation, API.Bible's free plan is 5,000
  calls a month shared with prod, and the script stops at the audit's 900-call cap.
- **Suggested fix (B3):** in `cleanText` and `parseChapterContent`, turn block tags into a space,
  drop stanza-label and note elements, accept `\d+(-\d+)?` and key both numbers, keep a verse that
  sits in a heading element, and strip the "Psalm N" heading on the single-verse path. The same
  fix clears the NIV, NLT and NKJV rows of `verse_cache` (D19). Ride along (D20): `tokenize` in
  `lib/align.ts` splits a word on punctuation between two letters. Fix `.env.example` (it names
  `NLT_API_KEY`; the adapter reads `API_BIBLE_KEY`).

## RC13. Reader habits (kept)

The reader says something the verse doesn't have, and each costs points (D8, D18).

- **Verse numbers said aloud:** 10,364 of 10,364 KJV chunks at chunk size 3, mostly 90-99%. KJV
  Genesis 1:1-3 said "1 In the beginning... 2 And the earth... 3 And God said..." → 94%. Repro:
  `npx tsx scripts/grading-audit/run.ts --chunk-size 3 --pass reference:verse-numbers`.
- **The reference said before or after:** `~~genesis~~ ~~1:1.~~ In the beginning God created the
  heaven and the earth.` 83%. A trailing "amen": `Jesus wept. ~~amen.~~` 67%. Repro: `--pass
  reference:`.
- **Contractions:** "I'll" for "I will": 6,799 KJV verses under 100 (4,239 under 90), 9,147 ESV.
  The other way, NLT prints contractions in 597 sample verses and NIV in 85; said in full, every
  one fails. Repro: `npx tsx scripts/grading-audit/run.ts --pass contraction:` (add `--source NLT`).

## RC10. Soniox lifecycle

Not grading, but it fails recordings.

- **No delete:** `transcribeWithSoniox` in `supabase/functions/process-recording/index.ts` never
  deletes the upload or the transcription. Soniox caps an organization at 1,000 files and 2,000
  transcriptions and auto-deletes after 30 days, so at about 33 batch recordings a day every batch
  recording fails.
- **No 429 back-off:** a 429 on job create or status poll throws; the function answers "Processing
  failed", `processRecording` in `lib/api/recording.ts` throws, and `hooks/use-recording.ts` shows
  "Recording failed". The limit is per organization; 27 audit clips got 429 while two audit runs
  were calling at once.
- **Dates:** v5 models removed 2026-12-15 (routed to v6, RC2 grows); `api_key` in the websocket
  start frame refused after 2027-01-15 (old builds fall to batch).
- **Repro:** none without Soniox calls; the code above shows the missing delete and retry.
- **Suggested fix (C1-C3):** delete the transcription and file in a `finally`; retry 429 with
  jitter inside the deadline and return a specific "busy" error; send the key as a websocket
  subprotocol in `lib/transcription/live-session.ts`.

## RC9. Card wording

- "Perfect!" at 90-99% with visible mistakes (`STATUS_CONFIG` in `components/study/ResultCard.tsx`);
  "Extra: wasn't in the verse" for a word that is in the verse but was said elsewhere; "Hard
  passed" when the review didn't count. This is the part of the review story the aligner can't fix.
- **Repro:** the John 3:16 reorder card below; 18 of 184 Bread-suggested verses show a run of 2+
  identical struck and underlined words when said in KJV order against ESV.
- **Suggested fix:** "Perfect!" only at 100, "Great!" at 90-99 (D14); mark a word struck and
  underlined on the same card as "moved". No scoring change.

## RC8. Pooled session score (kept)

- KJV Psalm 23:1-6, Hard, one verse per chunk, verse 1 never said or revealed: final 92, "Hard
  passed", a review counts. Whole-chapter sessions survive a silent verse in 1,165 of 1,189
  chapters. An empty transcript is graded as a 0% attempt.
- **Repro:** todo RC8.
- **No fix:** the pass rule stays 90% overall with no per-chunk floor (D6), and an empty transcript
  stays a 0% attempt (D15).

## RC12. Context echo (kept)

- Sending the verse as Soniox context (`context` in `transcribeWithSoniox` and in
  `lib/transcription/live-session.ts`) makes some wrong words come back as the verse's word: a
  similar-sounding swap 7 of 18 (batch v5), 6 of 18 (v6); a modern word for an archaic one 3 of 15
  (v5), 6 of 15 (v6); 0 of 108 for omitted words, unrelated swaps, skipped clauses, reorders and
  paraphrase. Without context, correct recitations fail far more (real-time v6: 21 of 30 under
  100). Kept (D12).

## Matches the review's story

The App Store review, paraphrased: the second verse was recited perfectly, yet the words said
were crossed out and the same words listed again as missing, the same on 3-4 retries at
different paces. Phones at the time ran 1.3.0, whose aligner is the one before 0a63382. 1.3.0's
card colours match the reviewer's reading (struck = said, underlined = missing); 1.2.0's are the
other way round.

**NIV, NLT and NKJV: reproduced on 1.3.0 with real transcripts.** The RC7 glue shows exactly this,
identically on every retry at any pace, on every build (the glue is server-side). Graded by the
1.3.0 aligner, 36 of 150 NIV, 33 of 150 NLT and 32 of 150 NKJV correct voice recitations show 2 or
more of the reader's words both struck and underlined (the current aligner: the same counts).
About a quarter of all verses in those translations carry a glue point, poetry far more. Card on
1.3.0: `The LORD is my __shepherd;I__ ~~shepherd,~~ ~~i~~ shall not want.` 70%
(`npx tsx scripts/grading-audit/run.ts --card --expected "The LORD is my shepherd;I shall not want." --transcript "The Lord is my shepherd, I shall not want." --aligner .expo/grading-audit/old-align.ts`).
The leading explanation if the reviewer's account was on NIV, NLT or NKJV.

**KJV and ESV: no real transcript of a correct recitation showed it on 1.3.0.** Over 1,453 real
Soniox transcripts, the 1.3.0 aligner showed one look-alike pair (an ESV "2,172" against "2172",
67%) and no run of 2+; 150 ESV voice clips, none. Every engine formatting variation (apostrophes,
hyphens, dashes, quotes, case, `LORD`) gives 0 look-alike pairs on 1.3.0. Candidates, most likely
first:

1. **The right words in a different order.** A transposition shows the moved phrase struck where
   the reader said it and underlined where the verse has it, on every build and every retry. The
   likeliest source is a translation that shares the ESV's words but orders clauses differently
   (ESV is the account default), or the reader's own habit. Card (KJV John 3:16, "he gave" said
   after "Son", 1.3.0 and current): `...that __he__ __gave__ his only begotten Son, ~~he~~
   ~~gave,~~ that whosoever...` 85%
   (`npx tsx scripts/grading-audit/run.ts --card --ref "John 3:16" --transcript "For God so loved the world, that his only begotten Son he gave, that whosoever believeth in him should not perish, but have everlasting life." --aligner .expo/grading-audit/old-align.ts`).
   Not an aligner bug; RC9.
2. **Digits on 1.3.0**, fixed for standard forms by 0a63382: KJV Matthew 18:22 → `Until __seventy__
   ~~70~~ times __seven.__ ~~7.~~` 70% on 1.3.0, 100% current
   (`npx tsx scripts/grading-audit/run.ts --card --ref "Matthew 18:22" --transcript "Jesus saith unto him, I say not unto thee, Until 7 times: but, Until 70 times 7." --aligner .expo/grading-audit/old-align.ts`).
   Soniox printed digits for Matthew 18:22 in 0 of 8 clips with the app's context. Low prior.
3. **1.2.0 apostrophe and hyphen desync** (before 041aa49): the same word struck then underlined,
   one word per apostrophe, never a run, inverted colours. Low prior.
4. **Spellings** (RC1): `__Judaea__ ~~judea~~` on KJV Matthew 2:1, 93%. One word, usually 89-96%.
5. **Current aligner only, synthetic:** a restart inside a number (F1) and a slip beside a
   compound (RC3). 0 real clips on 1.3.0.

**Rejected:** a different translation's vocabulary alone. The card would show visibly different
words (`__your__ ~~thine~~`) beside any identical pairs, which the review doesn't describe.

A retry repeats the card: the card is a pure function of the transcript, and Soniox gave the same
transcript on 34 of 35 reruns of the same audio. To confirm the story: the reviewer's verse and
translation, or `session_attempts` for an account around the review date with 3-4 attempts at
60-89%.

## Checked and clean

- Keyed chunking at sizes 1, 2, 3, 5 and all, three difficulties: every word once, in order; masks
  right (393,606 chunks).
- 0 KJV verses under 100 for: plain, engine-style punctuation and capitals, curly quotes either
  side, a dropped possessive apostrophe, hyphen joins and splits, em and en dashes, NBSP, BOM,
  um/uh/hmm, standard digits.
- Full ESV by chapter: plain 3 under 100, all hyphen compounds (RC3 class: Genesis 19:12, Joshua
  14:15, 21:11); digits printed in the verse and said as words, 1 (2 Chronicles 35:7, 80%); no
  printed contractions, no fractions, no HTML entities; keyed chunking clean at every size (392,916
  chunks).
- NIV, NLT and NKJV samples, graded against their text run through `asPrinted` in
  `scripts/grading-audit/variations.ts` (a one-off check; the harness has no option for it): plain
  and engine-style 0 under 100 in NIV and NKJV, NLT only its fractions (RC14); digits printed in
  the verse and said as words, 0 in NIV; keyed chunking clean at every size. Characters: standard
  punctuation, ’ ‘ “ ” — –, and in NIV and NKJV the 22 Hebrew stanza letters (RC7). No HTML entities
  or leftover tags reach the text.
- KJV bundle: all 31,102 verses present, pure ASCII, no titles or stanza letters.
- Real-time finishing: the last word never went missing on a fast finish in the Soniox run.

## Not covered

- Real human voices, accents, children, noise on real microphones; no phone was used.
- NIV, NLT and NKJV beyond the 270-chapter sample (about 919 chapters each); the classes found are
  structural, but rarer layouts (lists, letters, other merged rows) may hide more.
- Prod `verse_cache`: how many poisoned ESV rows and glued API.Bible rows are live.
- Whether the local Soniox key shares prod's organization.
- Long multi-verse chunks through Soniox, and the licensed translations through the real-time path.
- 9 voice clips with an empty transcript: `say` writing an empty file, or Soniox returning nothing.
- A v6 replay of the 457-clip fixture.
- The reviewer's verse, translation and build.

## Decisions

- 2026-11-13 · The harness is a dev tool in `scripts/grading-audit/`, run by `tsx`, not app code
  in `lib/` · Only the regression test lives in `lib/__tests__/`.
- 2026-11-13 · "Same word missing and added" is judged by the app's own matcher, plus a visual key
  (lowercase, no punctuation or invisible characters) · Both are what a reader could call "the
  same word".
- 2026-11-13 · Known bugs are node:test `todo` cases · They run and print without failing
  `npm run check`; removing `todo` turns one into a guard once its fix lands.
- 2026-11-14 · The fixture test pins the set of failing clips, not a count · A change that fixes
  ten clips and breaks ten others must fail.
- 2026-11-14 · A person is talking, not spelling: a transcript word that differs from the verse
  only in how it is written (spelling, spacing, accents, hyphens) is correct, and the card shows
  the verse's spelling. No rules for people using the app wrong · Grading checks what was said.
- 2026-11-14 · D1: no half credit for archaic and modern forms (hath/has, spake/spoke) · Keep it
  simple; they are different words.
- 2026-11-14 · D2: every spelling-only difference counts as correct, including Sion/Zion and
  altogether/"all together" · The talking-not-spelling rule.
- 2026-11-14 · D3: no sound-alike map · Trust the reader's enunciation and the verse sent to
  Soniox as context.
- 2026-11-14 · D4: accents never cost a word · Covered by the spelling rule.
- 2026-11-14 · D5: "six six six" for 666 and "60" for "threescore" stay wrong · They would break
  the "72 ≠ 7 2" guard, and Soniox keeps score words as words.
- 2026-11-14 · D6: the pass rule stays 90% overall, with no per-chunk floor · Fixes cover correct
  recitations graded wrong, not new pass rules.
- 2026-11-14 · D7: no peek taint across sessions · No new pass rules.
- 2026-11-14 · D8: spoken references, verse numbers and "amen" are not stripped · No rules for
  people using the app wrong.
- 2026-11-14 · D9: a restart costs the repeated words · Keeps the 2026-08-25 decision; with A3 it
  costs only those words.
- 2026-11-14 · D10: no hint that the reader's wording looks like another translation · Not a
  grading fix.
- 2026-11-14 · D11: move both Soniox model strings to v6 on purpose before 2026-12-15 · Soniox
  reroutes v5 then with no deploy; moving first lets the fixture be replayed on v6.
- 2026-11-14 · D12: keep sending the verse as Soniox context; RC12 is accepted · Without it,
  correct recitations fail far more.
- 2026-11-14 · D13, D19: the adapter fixes (B1, B3) also clear the saved ESV, NIV, NLT and NKJV
  rows of `verse_cache` · A poisoned or glued row stays wrong until something overwrites it.
- 2026-11-14 · D14: "Perfect!" only at 100; 90-99 says "Great!" · A card with visible mistakes
  isn't perfect.
- 2026-11-14 · D15: an empty transcript stays a 0% attempt · No change to the pass rule.
- 2026-11-14 · D16: no separate Soniox account for audits and local dev · `voice.ts` throttles
  itself and deletes its own files and transcriptions.
- 2026-11-14 · D18: "don't" for "do not" stays wrong, both ways · A contraction is said
  differently, not only written differently.
- 2026-11-14 · D20: the aligner splits a word on punctuation between two letters · Text already
  cached or served by an old function still grades right, and it guards the next adapter bug.
- 2026-11-14 · D21: fractions said in words match NLT's "3-1/4" · That is how a person says it.
- 2026-11-14 · Test tools may keep fetched licensed text in gitignored local folders
  (`.expo/grading-audit/`) · It never leaves the machine; deleting it is not required.
