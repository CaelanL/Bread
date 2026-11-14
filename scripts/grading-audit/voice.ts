// Computer-voice recitations through the real batch path: macOS `say` makes an AAC m4a of
// one verse, posted to the LOCAL `process-recording` function exactly as the app posts it
// (audio, durationMs, actualVerse = chunk text). Soniox usage is real, so clips are capped.
//
//   npx tsx scripts/grading-audit/voice.ts plan            # list the clips it would make
//   npx tsx scripts/grading-audit/voice.ts run [--max N]   # make and transcribe them
//
// KJV transcripts go to scripts/grading-audit/fixtures/say-kjv.json (committed).
// Licensed transcripts go to .expo/grading-audit/say-<VERSION>.json (gitignored).
// Replay them with `npm run audit:grading -- --replay <file>`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHeaders, functionUrl, popularPassages, signIn } from './local';
import { KJV_FIXTURE, loadSource, OUT_DIR, refText, type Clip, type VerseMap } from './run';

const CAP = 200;
const VOICES = [
  { voice: 'Samantha', rate: 175 },
  { voice: 'Daniel', rate: 175 },
  { voice: 'Samantha', rate: 230 },
  { voice: 'Daniel', rate: 140 },
];
const outFile = (version: string) => (version === 'KJV' ? KJV_FIXTURE : join(OUT_DIR, `say-${version}.json`));

// KJV verses A flagged as risky, a few per cause, spread across the Bible.
const RISKY: [string, RegExp, number][] = [
  ['article number', /\b(an|a) (hundred|thousand)\b/i, 10],
  ['score number', /score\b/i, 8],
  ['unit and tens number', /\b(one|two|three|four|five|six|seven|eight|nine) and (twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)/i, 8],
  ['thousand and hundred', /thousand and (one|two|three|four|five|six|seven|eight|nine) hundred/i, 6],
  ['standard number', /\b(seventy|forty|twelve|hundred|thousand)\b/i, 6],
  ['number across comma', /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety), (one|two|three|four|five|six|seven|eight|nine)\b/i, 3],
  ['british spelling', /\b(honour|favour|labour|neighbour|savour|saviour|sepulchre|marvelled|valour|colour)/i, 14],
  ['archaic spelling', /\b(shew|shewed|vail|intreat|enquire|stedfast|brasen|subtil|ancle|asswage)/i, 14],
  ['son', /\bSon\b/, 4],
  ['homophone', /\b(holy|wholly|reign|prey|pray|four|sow|knew|altar|mourning|soul|whole|piece|peace)\b/, 12],
  ['for ever', /\bfor ever\b/, 6],
  ['open compound', /\b(to day|to morrow|any thing|every one|every thing)\b/, 6],
  ['closed compound', /\b(forasmuch|nevertheless|withal|inasmuch|insomuch)\b/i, 8],
  ['name possessive', /\b[A-Z][a-z]*s'/, 5],
  ['hyphenated name', /\b[A-Z][a-z]+-[a-z]+/, 5],
  ['vocative O', /\bO (LORD|God|Israel|Jerusalem)/, 4],
];
const MAX_WORDS = 45;

interface Planned {
  ref: string;
  version: string;
  why: string;
}

function plan(): Planned[] {
  const kjv = loadSource('KJV');
  const out: Planned[] = [];
  const used = new Set<string>();
  const entries = Object.entries(kjv).filter(([, t]) => t.split(/\s+/).length <= MAX_WORDS);
  for (const [why, re, n] of RISKY) {
    const hits = entries.filter(([ref, t]) => re.test(t) && !used.has(ref));
    const step = Math.max(1, Math.floor(hits.length / n));
    for (let i = 0; i < hits.length && out.filter((p) => p.why === why).length < n; i += step) {
      used.add(hits[i][0]);
      out.push({ ref: hits[i][0], version: 'KJV', why });
    }
  }
  const popularVerses = popularPassages().flatMap((p) => {
    const m = p.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/)!;
    return Array.from({ length: Number(m[4] ?? m[3]) - Number(m[3]) + 1 }, (_, i) => `${m[1]} ${m[2]}:${Number(m[3]) + i}`);
  });
  const popular = [...new Set(popularVerses)].filter((ref) => kjv[ref] && kjv[ref].split(/\s+/).length <= MAX_WORDS);
  const kjvPopular = popular.filter((ref) => !used.has(ref)).filter((_, i) => i % 3 === 0).slice(0, 26);
  out.push(...kjvPopular.map((ref) => ({ ref, version: 'KJV', why: 'popular' })));
  const esvFile = join(OUT_DIR, 'ESV.json');
  if (existsSync(esvFile)) {
    const esv: VerseMap = JSON.parse(readFileSync(esvFile, 'utf8'));
    const esvRefs = Object.keys(esv).filter((ref) => esv[ref] && esv[ref].split(/\s+/).length <= MAX_WORDS);
    const numbered = esvRefs.filter((ref) => /\d|hundred|thousand|seventy|forty|twelve/i.test(esv[ref])).slice(0, 15);
    const rest = esvRefs.filter((ref) => !numbered.includes(ref) && popular.includes(ref)).filter((_, i) => i % 3 === 1);
    out.push(...[...numbered, ...rest].slice(0, CAP - out.length).map((ref) => ({ ref, version: 'ESV', why: numbered.includes(ref) ? 'ESV numbers' : 'ESV popular' })));
  }
  return out.slice(0, CAP);
}

function readClips(version: string): Clip[] {
  const file = outFile(version);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

async function transcribe(token: string, text: string, voice: string, rate: number, dir: string): Promise<string> {
  const file = join(dir, `clip-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`);
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', file, '--file-format=m4af', '--data-format=aac', text]);
  const info = execFileSync('afinfo', [file], { encoding: 'utf8' });
  const seconds = Number(info.match(/estimated duration: ([\d.]+)/)?.[1]);
  const form = new FormData();
  form.append('audio', new Blob([readFileSync(file)], { type: 'audio/m4a' }), 'recording.m4a');
  form.append('durationMs', String(Math.round(seconds * 1000)));
  form.append('actualVerse', text);
  const res = await fetch(functionUrl('process-recording'), { method: 'POST', headers: authHeaders(token), body: form });
  const body = JSON.parse((await res.text()).trim());
  rmSync(file);
  if (!res.ok || typeof body.cleanedTranscription !== 'string') throw new Error(`process-recording ${res.status}: ${body.error ?? 'no transcript'}`);
  return body.cleanedTranscription;
}

async function main() {
  const planned = plan();
  if (process.argv[2] === 'plan') {
    for (const p of planned) console.log(`${p.version} ${p.ref} (${p.why})`);
    console.log(`${planned.length} clips`);
    return;
  }
  if (process.argv[2] !== 'run') throw new Error('Usage: voice.ts plan|run [--max N]');
  const maxIndex = process.argv.indexOf('--max');
  const max = Math.min(CAP, maxIndex > 0 ? Number(process.argv[maxIndex + 1]) : CAP);
  const sources = new Map<string, VerseMap>();
  const done = new Map<string, Clip[]>(['KJV', 'ESV'].map((v) => [v, readClips(v)]));
  const total = () => [...done.values()].reduce((n, c) => n + c.length, 0);
  const token = await signIn('reader-a@example.test');
  const dir = mkdtempSync(join(tmpdir(), 'bread-say-'));
  mkdirSync(join(__dirname, 'fixtures'), { recursive: true });
  try {
    for (const [i, p] of planned.entries()) {
      if (total() >= max) break;
      const clips = done.get(p.version) ?? [];
      if (clips.some((c) => c.ref === p.ref)) continue;
      if (!sources.has(p.version)) sources.set(p.version, loadSource(p.version));
      const { voice, rate } = VOICES[i % VOICES.length];
      const text = refText(sources.get(p.version)!, p.ref);
      try {
        const transcript = await transcribe(token, text, voice, rate, dir);
        clips.push({ ref: p.ref, version: p.version, voice, rate, transcript });
        done.set(p.version, clips);
        writeFileSync(outFile(p.version), `${JSON.stringify(clips, null, 1)}\n`);
        console.log(`${total()}/${max} ${p.version} ${p.ref} ${voice}@${rate}`);
      } catch (e) {
        console.log(`skip ${p.version} ${p.ref}: ${e instanceof Error ? e.message : e}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
