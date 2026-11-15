// Computer-voice recitations through the batch transcription: macOS `say` makes an AAC m4a of
// one chunk, sent to Soniox with the request `process-recording` makes (default), or posted to
// the LOCAL `process-recording` exactly as the app posts it (`--via-function`). Soniox usage is
// real, so clips are capped.
//
//   npx tsx scripts/grading-audit/voice.ts plan            # list the clips it would make
//   npx tsx scripts/grading-audit/voice.ts run [--max N] [--via-function]   # make and transcribe them
//   npx tsx scripts/grading-audit/voice.ts run --version NIV   # licensed round, at most 150 clips
//
// KJV transcripts go to scripts/grading-audit/fixtures/say-kjv.json (committed).
// Licensed transcripts go to .expo/grading-audit/say-<VERSION>.json (first round) and
// voice-<VERSION>.json (licensed round), both gitignored. A licensed round needs the text from
// fetch-licensed.ts: half its clips are verses a number, contraction, compound or possessive pass
// touches, half a spread of the rest.
// Each clip starts with 300 ms of silence: `say` starting at sample 0 made Soniox drop the first
// word (RC11 in docs/grading-audit.md). The first round's clips have no lead-in.
// Replay them with `npx tsx scripts/grading-audit/run.ts --replay <file>`.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { authHeaders, functionUrl, popularPassages, signIn } from './local';
import { clipId, KJV_FIXTURE, loadSource, OUT_DIR, refText, type Clip, type VerseMap } from './run';
import { PASSES } from './variations';

const FIRST_WAVE = 200;
const CAP = 1000;
const VOICES = [
  { voice: 'Samantha', rate: 175 },
  { voice: 'Daniel', rate: 175 },
  { voice: 'Samantha', rate: 230 },
  { voice: 'Daniel', rate: 140 },
];
const LICENSED_CAP = 150;
const licensedVersion = process.argv.includes('--version') ? process.argv[process.argv.indexOf('--version') + 1] : undefined;
const outFile = (version: string) =>
  version === 'KJV' ? KJV_FIXTURE : join(OUT_DIR, `${licensedVersion ? 'voice' : 'say'}-${version}.json`);

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
// Second wave: more voices and speeds, every popular verse, a spread of the whole KJV, all of the
// ESV sample, and long multi-verse chunks (one chunk = several verses, as at chunk size 2+).
const WIDE_VOICES = ['Samantha', 'Daniel', 'Karen', 'Moira', 'Rishi', 'Tessa', 'Fred', 'Eddy (English (US))', 'Flo (English (UK))'];
const WIDE_RATES = [120, 150, 175, 200, 230, 260];
const MAX_LONG_WORDS = 160;

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
  return [...out.slice(0, FIRST_WAVE), ...secondWave(kjv, popular, new Set(out.map((p) => p.ref)))].slice(0, CAP);
}

function rangeRefs(ref: string): string[] {
  const m = ref.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/)!;
  return Array.from({ length: Number(m[4] ?? m[3]) - Number(m[3]) + 1 }, (_, i) => `${m[1]} ${m[2]}:${Number(m[3]) + i}`);
}

function secondWave(kjv: VerseMap, popular: string[], used: Set<string>): Planned[] {
  const out: Planned[] = [];
  const add = (ref: string, version: string, why: string) => {
    if (used.has(`${version} ${ref}`) || (version === 'KJV' && used.has(ref))) return;
    used.add(`${version} ${ref}`);
    out.push({ ref, version, why });
  };
  const words = (map: VerseMap, ref: string) => refText(map, ref).split(/\s+/).length;
  // More of each risky cause.
  const entries = Object.entries(kjv).filter(([, t]) => t.split(/\s+/).length <= 60);
  for (const [why, re, n] of RISKY) {
    const hits = entries.filter(([ref, t]) => re.test(t) && !used.has(ref));
    const step = Math.max(1, Math.floor(hits.length / (n * 2)));
    for (let i = 0, k = 0; i < hits.length && k < n * 2; i += step, k++) add(hits[i][0], 'KJV', why);
  }
  for (const ref of popular) add(ref, 'KJV', 'popular');
  // A spread across the whole Bible.
  const all = Object.keys(kjv).filter((ref) => kjv[ref].split(/\s+/).length <= 60);
  for (let i = 0; i < all.length; i += Math.floor(all.length / 150)) add(all[i], 'KJV', 'spread');
  // Long chunks: suggested multi-verse passages, then 3-verse windows across the Bible.
  const multi = popularPassages().filter((p) => p.includes('-'));
  for (const ref of multi) if (rangeRefs(ref).every((r) => kjv[r]) && words(kjv, ref) <= MAX_LONG_WORDS) add(ref, 'KJV', 'long chunk');
  for (let i = 0; i < all.length; i += Math.floor(all.length / 40)) {
    const m = all[i].match(/^(.+) (\d+):(\d+)$/)!;
    const ref = `${m[1]} ${m[2]}:${m[3]}-${Number(m[3]) + 2}`;
    if (rangeRefs(ref).every((r) => kjv[r]) && words(kjv, ref) <= MAX_LONG_WORDS) add(ref, 'KJV', 'long chunk');
  }
  const esvFile = join(OUT_DIR, 'ESV.json');
  if (existsSync(esvFile)) {
    const esv: VerseMap = JSON.parse(readFileSync(esvFile, 'utf8'));
    for (const ref of multi) if (rangeRefs(ref).every((r) => esv[r]) && words(esv, ref) <= MAX_LONG_WORDS) add(ref, 'ESV', 'long chunk');
    for (const ref of Object.keys(esv)) if (esv[ref]) add(ref, 'ESV', 'ESV verse');
  }
  return out;
}

function licensedPlan(version: string): Planned[] {
  const text = loadSource(version);
  const refs = Object.keys(text).filter((ref) => text[ref] && text[ref].split(/\s+/).length <= MAX_WORDS);
  const risky = PASSES.filter((p) => ['numbers', 'contraction', 'compound'].includes(p.group) || p.name.startsWith('possessive:'));
  const flagged = refs.filter((ref) => {
    const m = ref.match(/^(.+) (\d+):(\d+)$/)!;
    const chunk = { book: m[1], chapter: Number(m[2]), verseStart: Number(m[3]), verseEnd: Number(m[3]), verseTexts: [] };
    return risky.some((p) => p.make(text[ref], chunk));
  });
  const spread = (list: string[], n: number) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);
  const picked = spread(flagged, LICENSED_CAP / 2);
  const rest = refs.filter((ref) => !picked.includes(ref));
  return [
    ...picked.map((ref) => ({ ref, version, why: 'text pass' })),
    ...spread(rest, LICENSED_CAP - picked.length).map((ref) => ({ ref, version, why: 'spread' })),
  ];
}

function voiceFor(i: number): { voice: string; rate: number } {
  if (i < FIRST_WAVE && !licensedVersion) return VOICES[i % VOICES.length];
  return { voice: WIDE_VOICES[i % WIDE_VOICES.length], rate: WIDE_RATES[(i * 7) % WIDE_RATES.length] };
}

function readClips(version: string): Clip[] {
  const file = outFile(version);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

// process-recording never deletes what it creates at Soniox, and the account caps stored files
// (1,000) and transcriptions (2,000). So volume goes straight to Soniox with the same request
// the function makes, and each call deletes its own file and transcription. `--via-function`
// uses the real function path instead (keep that to a handful of clips).
const SONIOX = 'https://api.soniox.com/v1';
function sonioxKey(): string {
  const line = readFileSync(join(__dirname, '../../supabase/functions/.env'), 'utf8').split('\n').find((l) => l.startsWith('SONIOX_API_KEY='));
  const key = line?.slice('SONIOX_API_KEY='.length).replace(/^["']|["']$/g, '').trim();
  if (!key) throw new Error('SONIOX_API_KEY missing from supabase/functions/.env');
  return key;
}

async function transcribeDirect(audio: Buffer, text: string, model = 'stt-async-v6'): Promise<string> {
  const headers = { Authorization: `Bearer ${sonioxKey()}` };
  const signal = () => AbortSignal.timeout(60_000); // a hung request stalled a whole run
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)]), 'recording.m4a');
  const upload = await fetch(`${SONIOX}/files`, { method: 'POST', headers, body: form, signal: signal() });
  if (!upload.ok) throw new Error(`soniox upload ${upload.status}`);
  const fileId: string = (await upload.json()).id;
  let txId: string | undefined;
  try {
    const job = await fetch(`${SONIOX}/transcriptions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      signal: signal(),
      // Same body as transcribeWithSoniox in supabase/functions/process-recording/index.ts.
      body: JSON.stringify({
        file_id: fileId,
        model,
        language_hints: ['en'],
        // `--no-context` measures what the verse as context is worth.
        ...(process.argv.includes('--no-context') ? {} : {
          context: {
            general: [
              { key: 'domain', value: 'Bible' },
              { key: 'topic', value: 'Bible verse memory recitation attempt' },
            ],
            text,
          },
        }),
      }),
    });
    if (!job.ok) throw new Error(`soniox job ${job.status}`);
    txId = (await job.json()).id as string;
    for (let i = 0; ; i++) {
      const poll = await fetch(`${SONIOX}/transcriptions/${txId}`, { headers, signal: signal() });
      if (!poll.ok) throw new Error(`soniox poll ${poll.status}`);
      const status = await poll.json();
      if (status.status === 'completed') break;
      if (status.status === 'error' || i > 180) throw new Error(`soniox ${status.status}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const { text: transcript } = await (await fetch(`${SONIOX}/transcriptions/${txId}/transcript`, { headers, signal: signal() })).json();
    return transcript ?? '';
  } finally {
    if (txId) await fetch(`${SONIOX}/transcriptions/${txId}`, { method: 'DELETE', headers, signal: signal() });
    await fetch(`${SONIOX}/files/${fileId}`, { method: 'DELETE', headers, signal: signal() });
  }
}

async function transcribe(token: string, text: string, voice: string, rate: number, dir: string): Promise<string> {
  const file = sayFile(text, voice, rate, dir, false);
  if (!process.argv.includes('--via-function')) {
    try {
      return await transcribeDirect(readFileSync(file), text);
    } finally {
      rmSync(file);
    }
  }
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

// ---------- replay: the same clips again on another model ----------
// `say` is deterministic, so a fixture's clips can be remade from ref, voice and rate (with the
// 300 ms lead-in) and sent to another model. Batch goes straight to Soniox like `run`; `--live`
// streams 16 kHz PCM over the websocket at real-time pace with the start frame
// and the key protocol lib/transcription/live-session.ts sends (`--via-token` mints the key through the local
// transcription-token, as the app does, and takes the model it answers). Resumable: clips already
// in --out are skipped.
//   npx tsx scripts/grading-audit/voice.ts replay <fixture> --model stt-async-v6 --out <file> [--max N]
//   npx tsx scripts/grading-audit/voice.ts replay <fixture> --live --model stt-rt-v6 --out <file> [--via-token]
const LIVE_CLIPS = 150;
const LIVE_PICK = /\d|hundred|thousand|score\b|(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b|fold\b|honour|favour|labour|neighbour|savour|saviour|sepulchre|marvell|valour|colour|counsell|shew|vail|intreat|enquir|stedfast|brasen|subtil|ancle|asswage|\bfor ever\b|\bto (day|morrow)\b|\bany thing\b|\bevery (one|thing)\b|forasmuch|nevertheless|withal|inasmuch|insomuch|altogether|\b[A-Z][a-z]*ae[a-z]*|\b[A-Z][a-z]*s'|\b[A-Z][a-z]+-[a-z]+|\bSion\b|\bJuda\b|\bSara\b/;

// 120 clips spread over the number, spelling, compound and name clips, 30 over the rest.
export function liveSubset(clips: Clip[]): Clip[] {
  const kjv = loadSource('KJV');
  const spread = (list: Clip[], n: number) =>
    Array.from({ length: Math.min(n, list.length) }, (_, i) => list[Math.floor((i * list.length) / Math.min(n, list.length))]);
  const risky = clips.filter((c) => LIVE_PICK.test(refText(kjv, c.ref)));
  const picked = new Set([...spread(risky, 120), ...spread(clips.filter((c) => !risky.includes(c)), LIVE_CLIPS - 120)]);
  return clips.filter((c) => picked.has(c));
}

function sayFile(text: string, voice: string, rate: number, dir: string, pcm: boolean): string {
  const file = join(dir, `clip-${Date.now()}-${Math.random().toString(36).slice(2)}.${pcm ? 'wav' : 'm4a'}`);
  const format = pcm ? ['--file-format=WAVE', '--data-format=LEI16@16000'] : ['--file-format=m4af', '--data-format=aac'];
  execFileSync('say', ['-v', voice, '-r', String(rate), '-o', file, ...format, `[[slnc 300]] ${text}`]);
  return file;
}

function wavData(wav: Buffer): Buffer {
  for (let at = 12; at + 8 <= wav.length; at += 8 + wav.readUInt32LE(at + 4)) {
    if (wav.toString('ascii', at, at + 4) === 'data') return wav.subarray(at + 8, at + 8 + wav.readUInt32LE(at + 4));
  }
  throw new Error('no data chunk in wav');
}

interface LiveKey {
  apiKey: string;
  websocketUrl: string;
  model: string;
}

// The same temporary key transcription-token mints, straight from Soniox.
async function mintDirect(model: string): Promise<LiveKey> {
  const res = await fetch(`${SONIOX}/auth/temporary-api-key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sonioxKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 60, max_session_duration_seconds: 315 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`soniox mint ${res.status}`);
  return { apiKey: (await res.json()).api_key, websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket', model };
}

async function mintLiveKey(token: string): Promise<LiveKey> {
  const res = await fetch(functionUrl('transcription-token'), { method: 'POST', headers: authHeaders(token) });
  if (!res.ok) throw new Error(`transcription-token ${res.status}`);
  return res.json();
}

// 100 ms chunks at real-time pace, then the empty end-of-audio frame; the final tokens joined.
async function transcribeLive(pcm: Buffer, text: string, key: LiveKey): Promise<string> {
  const ws = new WebSocket(key.websocketUrl, ['soniox-api-key', key.apiKey]);
  const finals: string[] = [];
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('live timeout'));
    }, pcm.length / 32 + 30_000);
    const done = (error?: Error) => {
      clearTimeout(timeout);
      ws.close();
      if (error) reject(error);
      else resolve(finals.join(''));
    };
    ws.onopen = async () => {
      ws.send(JSON.stringify({
        model: key.model,
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        language_hints: ['en'],
        context: {
          general: [
            { key: 'domain', value: 'Bible' },
            { key: 'topic', value: 'Bible verse memory recitation attempt' },
          ],
          text,
        },
      }));
      for (let i = 0; i < pcm.length && ws.readyState === WebSocket.OPEN; i += 3200) {
        ws.send(pcm.subarray(i, i + 3200));
        await new Promise((r) => setTimeout(r, 100));
      }
      if (ws.readyState === WebSocket.OPEN) ws.send('');
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.error_code) return done(new Error(`soniox live ${msg.error_code}: ${msg.error_message}`));
      for (const t of msg.tokens ?? []) if (t.is_final && t.text !== '<fin>' && t.text !== '<end>') finals.push(t.text);
      if (msg.finished) done();
    };
    ws.onerror = () => done(new Error('socket error'));
  });
}

async function replayFixture() {
  const fixture = process.argv[3];
  const model = arg('model');
  const out = arg('out');
  const live = process.argv.includes('--live');
  const viaToken = process.argv.includes('--via-token');
  if (!fixture || !out || (!model && !viaToken)) throw new Error('Usage: voice.ts replay <fixture> --model <m> --out <file> [--live [--via-token]] [--max N]');
  const all: Clip[] = JSON.parse(readFileSync(fixture, 'utf8'));
  const clips = live ? liveSubset(all) : all;
  const done: Clip[] = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
  const have = new Set(done.map(clipId));
  const max = Math.min(clips.length, arg('max') ? Number(arg('max')) : clips.length);
  const todo = clips.filter((c) => !have.has(clipId(c))).slice(0, Math.max(0, max - done.length));
  const kjv = loadSource('KJV');
  const token = viaToken ? await signIn('reader-a@example.test') : '';
  const dir = mkdtempSync(join(tmpdir(), 'bread-replay-'));
  let calls = 0;
  let backoffs = 0;
  try {
    // Same pacing as `run`: 3 at a time, at most 10 a minute, 2 minutes after a 429.
    for (let b = 0; b < todo.length && backoffs < 3; b += 3) {
      const started = Date.now();
      let limited = false;
      const results = await Promise.all(todo.slice(b, b + 3).map(async (clip) => {
        const text = refText(kjv, clip.ref);
        const file = sayFile(text, clip.voice, clip.rate, dir, live);
        try {
          calls++;
          const transcript = live
            ? await transcribeLive(wavData(readFileSync(file)), text, viaToken ? await mintLiveKey(token) : await mintDirect(model!))
            : await transcribeDirect(readFileSync(file), text, model);
          return { ...clip, transcript };
        } catch (e) {
          console.log(`skip ${clipId(clip)}: ${e instanceof Error ? e.message : e}`);
          if (String(e).includes('429')) limited = true;
          return null;
        } finally {
          rmSync(file, { force: true });
        }
      }));
      for (const r of results) if (r) done.push(r);
      const order = new Map(all.map((c, i) => [clipId(c), i]));
      done.sort((x, y) => order.get(clipId(x))! - order.get(clipId(y))!);
      writeFileSync(out, `${JSON.stringify(done, null, 1)}\n`);
      console.log(`${done.length}/${max} (${calls} Soniox transcriptions this run)`);
      if (limited) {
        backoffs++;
        if (backoffs < 3) await new Promise((r) => setTimeout(r, 120_000));
      } else {
        backoffs = 0;
        if (!live) await new Promise((r) => setTimeout(r, Math.max(0, 18_000 - (Date.now() - started))));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`${done.length} clips in ${out}, ${done.filter((c) => !c.transcript.trim()).length} empty; ${calls} Soniox transcriptions this run`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv[2] === 'replay') return replayFixture();
  const planned = licensedVersion ? licensedPlan(licensedVersion) : plan();
  if (process.argv[2] === 'plan') {
    for (const p of planned) console.log(`${p.version} ${p.ref} (${p.why})`);
    console.log(`${planned.length} clips`);
    return;
  }
  if (process.argv[2] !== 'run') throw new Error('Usage: voice.ts plan|run [--max N]');
  const maxIndex = process.argv.indexOf('--max');
  const cap = licensedVersion ? LICENSED_CAP : CAP;
  const max = Math.min(cap, maxIndex > 0 ? Number(process.argv[maxIndex + 1]) : cap);
  const sources = new Map<string, VerseMap>();
  const done = new Map<string, Clip[]>((licensedVersion ? [licensedVersion] : ['KJV', 'ESV']).map((v) => [v, readClips(v)]));
  const total = () => [...done.values()].reduce((n, c) => n + c.length, 0);
  const token = await signIn('reader-a@example.test');
  const dir = mkdtempSync(join(tmpdir(), 'bread-say-'));
  mkdirSync(join(__dirname, 'fixtures'), { recursive: true });
  try {
    const todo = planned
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !(done.get(p.version) ?? []).some((c) => c.ref === p.ref));
    // Soniox's async rate limit is per organization: at most 3 jobs in flight and 10 a minute,
    // a 429 waits 2 minutes, and the third in a row stops the run (rerun to resume). Results are
    // written after each batch.
    let limited = false;
    let backoffs = 0;
    for (let b = 0; b < todo.length && total() < max && backoffs < 3; b += 3) {
      limited = false;
      const started = Date.now();
      const batch = todo.slice(b, b + Math.min(3, max - total()));
      const results = await Promise.all(batch.map(async ({ p, i }) => {
        if (!sources.has(p.version)) sources.set(p.version, loadSource(p.version));
        const { voice, rate } = voiceFor(i);
        try {
          const transcript = await transcribe(token, refText(sources.get(p.version)!, p.ref), voice, rate, dir);
          return { ref: p.ref, version: p.version, voice, rate, transcript };
        } catch (e) {
          console.log(`skip ${p.version} ${p.ref}: ${e instanceof Error ? e.message : e}`);
          if (String(e).includes('429')) limited = true;
          return null;
        }
      }));
      for (const clip of results) {
        if (!clip) continue;
        const clips = done.get(clip.version) ?? [];
        clips.push(clip);
        done.set(clip.version, clips);
      }
      for (const [version, clips] of done) if (clips.length) writeFileSync(outFile(version), `${JSON.stringify(clips, null, 1)}\n`);
      console.log(`${total()}/${max}`);
      if (limited) {
        backoffs++;
        console.log(backoffs < 3 ? 'Soniox rate limit hit; waiting 2 minutes.' : 'Soniox rate limit hit 3 times; stopped. Rerun later to resume.');
        if (backoffs < 3) await new Promise((r) => setTimeout(r, 120_000));
      } else {
        backoffs = 0;
        await new Promise((r) => setTimeout(r, Math.max(0, 18_000 - (Date.now() - started))));
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
