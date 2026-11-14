// Grading audit: feeds "correct" recitations through the app's own chunking, alignment
// and scoring, and reports every chunk that scores under 100.
//
//   npm run audit:grading -- [--source KJV|ESV|...] [--pass <prefix>] [--chunk-size 1|3|all]
//                            [--examples N] [--limit N] [--aligner <file>] [--check-chunks]
//                            [--replay <transcripts.json>]
//   npm run audit:grading -- --card (--ref "John 3:16" | --expected "<text>") --transcript "<text>" [--aligner <file>]
//
// Chunk size 1 (the default) skips `reference:verse-numbers-in-chunk`, which needs multi-verse
// chunks: run it with --chunk-size 3. Older aligners for --aligner, from git:
//   mkdir -p .expo/grading-audit
//   git show 0a63382^:lib/align.ts > .expo/grading-audit/old-align.ts           (1.3.0)
//   git show 041aa49^:lib/align.ts > .expo/grading-audit/align-pre-041aa49.ts   (1.1.1, 1.2.0)
//
// KJV comes from the bundle. Other translations come from `.expo/grading-audit/<VERSION>.json`
// (written by fetch-licensed.ts, gitignored); their text is never printed, only references
// and the words that went wrong. Reports land in `.expo/grading-audit/`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as appAlign from '../../lib/align';
import {
  calculateChunkScore,
  parseVerseIntoChunks,
  type AlignmentWord,
  type Chunk,
  type Difficulty,
} from '../../lib/study-chunks';
import type { SavedVerse } from '../../lib/storage';
import { toDigits } from './numbers';
import { PASSES, type ChunkRef, type Pass } from './variations';

export const OUT_DIR = join(__dirname, '../../.expo/grading-audit');
// Engine transcripts of KJV computer-voice recitations (voice.ts), committed as a fixture,
// and the clips in it that score under 100 today (`clipId` each).
export const KJV_FIXTURE = join(__dirname, 'fixtures/say-kjv.json');
export const KJV_FIXTURE_MISSES = join(__dirname, 'fixtures/say-kjv-misses.json');
type Align = (expected: string, transcript: string) => AlignmentWord[];

// ---------- verse sources ----------

export type VerseMap = Record<string, string>; // "John 3:16" -> text

export function loadSource(source: string): VerseMap {
  if (source === 'KJV') return JSON.parse(readFileSync(join(__dirname, '../../assets/bible/kjv-1769.json'), 'utf8'));
  const file = join(OUT_DIR, `${source}.json`);
  if (!existsSync(file)) throw new Error(`No ${file}. Run fetch-licensed.ts first.`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

interface Run {
  book: string;
  chapter: number;
  verses: { verse: number; text: string }[];
}

// Contiguous verse runs inside a chapter, in bundle order.
export function verseRuns(map: VerseMap): Run[] {
  const runs: Run[] = [];
  for (const [key, text] of Object.entries(map)) {
    const m = key.match(/^(.+) (\d+):(\d+)$/);
    if (!m) continue;
    const [book, chapter, verse] = [m[1], Number(m[2]), Number(m[3])];
    const last = runs.at(-1);
    if (last && last.book === book && last.chapter === chapter && last.verses.at(-1)!.verse === verse - 1) {
      last.verses.push({ verse, text });
    } else {
      runs.push({ book, chapter, verses: [{ verse, text }] });
    }
  }
  return runs;
}

export function savedVerse(run: Run, keyed = true): SavedVerse {
  return {
    id: `${run.book} ${run.chapter}`,
    book: run.book,
    chapter: run.chapter,
    verseStart: run.verses[0].verse,
    verseEnd: run.verses.at(-1)!.verse,
    text: run.verses.map((v) => v.text).join(' '),
    verses: keyed ? Object.fromEntries(run.verses.map((v) => [String(v.verse), v.text])) : {},
  } as SavedVerse;
}

function chunkRef(run: Run, chunk: Chunk): ChunkRef {
  const end = chunk.verseNumEnd ?? chunk.verseNum;
  return {
    book: run.book,
    chapter: run.chapter,
    verseStart: chunk.verseNum,
    verseEnd: end,
    verseTexts: run.verses.filter((v) => v.verse >= chunk.verseNum && v.verse <= end),
  };
}

const refLabel = (r: ChunkRef) =>
  `${r.book} ${r.chapter}:${r.verseStart}${r.verseEnd !== r.verseStart ? `-${r.verseEnd}` : ''}`;

// ---------- judging one alignment ----------

// What the reader sees: case, punctuation and invisible characters don't show.
const visualKey = (w: string) =>
  w.normalize('NFC').toLowerCase().replace(/[­​-‍⁠﻿]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

export interface Verdict {
  score: number;
  missing: string[];
  added: string[];
  // The review's symptom, "same word struck through and listed missing", three ways:
  sameWord: boolean; // a missing and an added word the current app matcher calls equal
  lookAlike: boolean; // a missing and an added word that look the same on screen
  sameNumber: boolean; // the missing words and the added words say the same number
  repeated: number; // how many on-screen words are both missing and added (2+ = a run of the reader's own words)
}

function repeatedWords(missing: string[], added: string[]): number {
  const left = added.map(visualKey);
  let n = 0;
  for (const m of missing.map(visualKey)) {
    const i = left.indexOf(m);
    if (m !== '' && i >= 0) {
      left.splice(i, 1);
      n++;
    }
  }
  return n;
}

const numberKey = (words: string[]) => visualKey(toDigits(words.join(' '), () => true).text.replace(/\s+/g, ''));

export function judge(align: Align, expected: string, transcript: string): Verdict {
  const alignment = align(expected, transcript);
  const missing = alignment.filter((a) => a.status === 'missing').map((a) => a.word);
  const added = alignment.filter((a) => a.status === 'added').map((a) => a.word);
  let sameWord = false;
  let lookAlike = false;
  for (const m of missing) {
    for (const a of added) {
      const pair = appAlign.alignTranscription(m, a);
      if (pair.length > 0 && pair.every((p) => p.status === 'correct')) sameWord = true;
      if (visualKey(m) !== '' && visualKey(m) === visualKey(a)) lookAlike = true;
    }
  }
  const sameNumber = /\d/.test(added.join('') + missing.join('')) && missing.length > 0 && numberKey(missing) === numberKey(added);
  return { score: calculateChunkScore(alignment), missing, added, sameWord, lookAlike, sameNumber, repeated: repeatedWords(missing, added) };
}

// ---------- the audit ----------

interface Example {
  ref: string;
  said?: string; // KJV only
  missing: string[];
  added: string[];
  score: number;
}

interface PassStats {
  pass: string;
  group: string;
  checked: number;
  under100: number;
  under90: number;
  sameWord: number;
  lookAlike: number;
  sameNumber: number;
  repeatedRun: number;
  signatures: Record<string, { count: number; example: Example }>;
}

const show = (s: string) => JSON.stringify(s).slice(1, -1);
const flags = (v: Verdict) =>
  `${v.sameWord ? ' SAME-WORD' : ''}${v.lookAlike ? ' LOOK-ALIKE' : ''}${v.sameNumber ? ' SAME-NUMBER' : ''}${v.repeated >= 2 ? ` RUN-OF-${v.repeated}` : ''}`;
const signature = (v: Verdict) =>
  `missing [${v.missing.map((w) => show(w.toLowerCase())).join(' ')}] added [${v.added.map(show).join(' ')}]${flags(v)}`;

function chunksFor(run: Run, chunkSize: string): Chunk[] {
  const size = chunkSize === 'all' ? run.verses.length : Number(chunkSize);
  return parseVerseIntoChunks(savedVerse(run), 'easy', size, 0);
}

export function audit(opts: {
  source: string;
  passes: Pass[];
  chunkSize: string;
  limit?: number;
  align: Align;
}): PassStats[] {
  const map = loadSource(opts.source);
  const licensed = opts.source !== 'KJV';
  const runs = verseRuns(map);
  const stats = new Map<string, PassStats>(
    opts.passes.map((p) => [p.name, { pass: p.name, group: p.group, checked: 0, under100: 0, under90: 0, sameWord: 0, lookAlike: 0, sameNumber: 0, repeatedRun: 0, signatures: {} }]),
  );
  let seen = 0;
  for (const run of runs) {
    for (const chunk of chunksFor(run, opts.chunkSize)) {
      if (opts.limit && seen++ >= opts.limit) return [...stats.values()];
      const ref = chunkRef(run, chunk);
      for (const pass of opts.passes) {
        const c = pass.make(chunk.text, ref);
        if (!c) continue;
        const s = stats.get(pass.name)!;
        s.checked++;
        const v = judge(opts.align, c.expected, c.transcript);
        if (v.score >= 100) continue;
        s.under100++;
        if (v.score < 90) s.under90++;
        if (v.sameWord) s.sameWord++;
        if (v.lookAlike) s.lookAlike++;
        if (v.sameNumber) s.sameNumber++;
        if (v.repeated >= 2) s.repeatedRun++;
        const key = signature(v);
        const sig = (s.signatures[key] ??= {
          count: 0,
          example: { ref: refLabel(ref), said: licensed ? undefined : c.transcript, missing: v.missing, added: v.added, score: v.score },
        });
        sig.count++;
      }
    }
  }
  return [...stats.values()];
}

// ---------- chunk building ----------

interface ChunkCheck {
  name: string;
  checked: number;
  failed: number;
  example?: string;
}

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean);
const stripSuperscript = (w: string) => w.replace(/^[⁰¹²³⁴⁵⁶⁷⁸⁹]+/, '');

export function checkChunks(source: string, limit?: number): ChunkCheck[] {
  const runs = verseRuns(loadSource(source)).slice(0, limit);
  const checks: Record<string, ChunkCheck> = {};
  const record = (name: string, ok: boolean, example: () => string) => {
    const c = (checks[name] ??= { name, checked: 0, failed: 0 });
    c.checked++;
    if (!ok) {
      c.failed++;
      c.example ??= example();
    }
  };
  const label = (run: Run, size: number) => `${run.book} ${run.chapter}:${run.verses[0].verse}-${run.verses.at(-1)!.verse} size ${size}`;

  for (const run of runs) {
    const total = run.verses.length;
    const allWords = wordsOf(run.verses.map((v) => v.text).join(' '));
    const sizes = [...new Set([1, 2, 3, 5, total].filter((n) => n <= total))];
    for (const size of sizes) {
      for (const difficulty of ['easy', 'medium', 'hard'] as Difficulty[]) {
        for (const seed of [0, 1]) {
          const chunks = parseVerseIntoChunks(savedVerse(run), difficulty, size, seed);
          const covered = wordsOf(chunks.map((c) => c.text).join(' '));
          record('keyed: chunks cover every word once, in order', covered.join(' ') === allWords.join(' '), () => label(run, size));
          for (const chunk of chunks) {
            const end = chunk.verseNumEnd ?? chunk.verseNum;
            const own = run.verses.filter((v) => v.verse >= chunk.verseNum && v.verse <= end).map((v) => v.text).join(' ');
            record('keyed: chunk.text is exactly its verses', wordsOf(chunk.text).join(' ') === wordsOf(own).join(' '), () => `${label(run, size)} chunk ${chunk.id}`);
            const shown = chunk.displayWords.map((w) => stripSuperscript(w.text)).filter(Boolean);
            record('displayWords match chunk.text word for word', shown.join(' ') === wordsOf(chunk.text).join(' '), () => `${label(run, size)} chunk ${chunk.id}`);
            const blanks = chunk.displayWords.map((w) => w.isBlank);
            const maskOk = difficulty === 'easy'
              ? blanks.every((b) => !b)
              : difficulty === 'hard'
                ? blanks.every(Boolean)
                : blanks.every((b, i) => i === 0 || b !== blanks[i - 1]);
            record(`${difficulty} mask pattern`, maskOk, () => `${label(run, size)} chunk ${chunk.id}`);
          }
        }
      }
      // Legacy path: no keyed verses, text split by sentences or words.
      const warn = console.warn;
      console.warn = () => {}; // the splitter warns on every call
      const legacy = parseVerseIntoChunks(savedVerse(run, false), 'easy', size, 0);
      console.warn = warn;
      const legacyWords = wordsOf(legacy.map((c) => c.text).join(' '));
      record('fallback splitter: chunks cover every word once, in order', legacyWords.join(' ') === allWords.join(' '), () =>
        `${label(run, size)}: ${allWords.length} words in passage, ${legacyWords.length} across chunks`);
      if (size === 1 && total > 1) {
        const matches = legacy.every((c, i) => wordsOf(c.text).join(' ') === wordsOf(run.verses[i].text).join(' '));
        record('fallback splitter: chunk i is verse i', matches, () => label(run, size));
      }
    }
  }
  return Object.values(checks);
}

// ---------- replay engine transcripts ----------

export interface Clip {
  ref: string;
  version: string;
  voice: string;
  rate: number;
  transcript: string;
}

export const clipId = (clip: Clip) => `${clip.ref} ${clip.voice}@${clip.rate}`;

export function replay(file: string, align: Align) {
  const clips: Clip[] = JSON.parse(readFileSync(file, 'utf8'));
  const sources = new Map<string, VerseMap>();
  return clips.map((clip) => {
    if (!sources.has(clip.version)) sources.set(clip.version, loadSource(clip.version));
    const text = refText(sources.get(clip.version)!, clip.ref);
    return { clip, verdict: judge(align, text, clip.transcript) };
  });
}

export function refText(map: VerseMap, ref: string): string {
  const m = ref.match(/^(.+ \d+):(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`Bad reference ${ref}`);
  const out: string[] = [];
  for (let v = Number(m[2]); v <= Number(m[3] ?? m[2]); v++) out.push(map[`${m[1]}:${v}`]);
  return out.join(' ');
}

// ---------- CLI ----------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const source = arg('source') ?? 'KJV';
  const licensed = source !== 'KJV';
  const examples = Number(arg('examples') ?? 3);
  const limit = arg('limit') ? Number(arg('limit')) : undefined;
  const alignerPath = arg('aligner');
  const align: Align = alignerPath
    ? (await import(pathToFileURL(resolve(alignerPath)).href)).alignTranscription
    : appAlign.alignTranscription;
  mkdirSync(OUT_DIR, { recursive: true });
  const tag = `${source}${alignerPath ? '-old-aligner' : ''}`;

  // One recitation as the result card shows it: ~~struck~~ = added, __underlined__ = missing
  // (the colours were the other way round before 2026-08-25).
  if (process.argv.includes('--card')) {
    const ref = arg('ref');
    const expected = arg('expected') ?? (ref ? refText(loadSource(source), ref) : undefined);
    const transcript = arg('transcript');
    if (expected === undefined || transcript === undefined) throw new Error('--card needs --ref or --expected, and --transcript');
    const alignment = align(expected, transcript);
    const card = alignment.map((w) => (w.status === 'added' ? `~~${w.word}~~` : w.status === 'missing' ? `__${w.word}__` : w.word));
    console.log(`${calculateChunkScore(alignment)}%  ${card.join(' ')}`);
    return;
  }

  if (process.argv.includes('--check-chunks')) {
    const checks = checkChunks(source, limit);
    for (const c of checks) console.log(`${c.failed ? 'FAIL' : 'ok  '} ${c.name}: ${c.failed}/${c.checked} failed${c.example ? ` (e.g. ${c.example})` : ''}`);
    writeFileSync(join(OUT_DIR, `chunks-${source}.json`), JSON.stringify(checks, null, 2));
    return;
  }

  const replayFile = arg('replay');
  if (replayFile) {
    const results = replay(replayFile, align);
    const bad = results.filter((r) => r.verdict.score < 100);
    for (const { clip, verdict } of bad) {
      const said = clip.version === 'KJV' ? ` said "${clip.transcript}"` : '';
      console.log(`${verdict.score}% ${clip.ref} ${clip.version} ${clip.voice}@${clip.rate}${said} missing [${verdict.missing.join(' ')}] added [${verdict.added.join(' ')}]${flags(verdict)}`);
    }
    console.log(`\n${bad.length}/${results.length} clips under 100, ${bad.filter((r) => r.verdict.score < 90).length} under 90, ${bad.filter((r) => r.verdict.sameWord).length} same-word, ${bad.filter((r) => r.verdict.lookAlike).length} look-alike, ${bad.filter((r) => r.verdict.sameNumber).length} same-number, ${bad.filter((r) => r.verdict.repeated >= 2).length} with 2+ words both missing and added`);
    writeFileSync(join(OUT_DIR, `replay-${tag}.json`), JSON.stringify(results, null, 2));
    return;
  }

  const prefix = arg('pass');
  const passes = PASSES.filter((p) => !prefix || p.name.startsWith(prefix));
  const chunkSize = arg('chunk-size') ?? '1';
  const stats = audit({ source, passes, chunkSize, limit, align });

  console.log(`source ${source}, chunk size ${chunkSize}${alignerPath ? `, aligner ${alignerPath}` : ''}\n`);
  console.log('pass'.padEnd(40) + 'checked'.padStart(8) + ' <100'.padStart(8) + ' <90'.padStart(8) + ' same'.padStart(7) + ' looks'.padStart(7) + ' num'.padStart(7) + ' run2+'.padStart(7));
  for (const s of stats) {
    console.log(s.pass.padEnd(40) + String(s.checked).padStart(8) + String(s.under100).padStart(8) + String(s.under90).padStart(8) + String(s.sameWord).padStart(7) + String(s.lookAlike).padStart(7) + String(s.sameNumber).padStart(7) + String(s.repeatedRun).padStart(7));
  }
  if (examples > 0) {
    for (const s of stats.filter((x) => x.under100 > 0)) {
      console.log(`\n== ${s.pass}`);
      const top = Object.entries(s.signatures).sort((a, b) => b[1].count - a[1].count).slice(0, examples);
      for (const [key, { count, example }] of top) {
        console.log(`  ${count}x ${key}`);
        console.log(`     e.g. ${example.ref} -> ${example.score}%${!licensed && example.said ? ` said "${example.said}"` : ''}`);
      }
    }
  }
  for (const s of stats) {
    s.signatures = Object.fromEntries(Object.entries(s.signatures).sort((a, b) => b[1].count - a[1].count).slice(0, 100));
  }
  writeFileSync(join(OUT_DIR, `report-${tag}-chunk${chunkSize}${prefix ? `-${prefix.replace(/[^a-z0-9-]/gi, '_')}` : ''}.json`), JSON.stringify(stats, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
