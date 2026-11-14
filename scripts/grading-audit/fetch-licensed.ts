// Fetches a licensed translation through the LOCAL `bible` function, chapter by chapter, into
// gitignored `.expo/grading-audit/` (never commit licensed text; delete the folder when done):
//   <VERSION>.json         verse text from the chapter path, keyed "Book 3:16"
//   <VERSION>-fetch.json   per chapter: verses expected (KJV numbering) and returned
//   <VERSION>-single.json  a few verses from the single-verse path, to compare with the chapter path
//
//   npx tsx scripts/grading-audit/fetch-licensed.ts <ESV|NIV|NLT|NKJV> [--chapters all|sample] [--list]
//
// Upstream calls are throttled and capped (Caelan's caps, 2026-11-14): ESV at most 8 a minute
// (Crossway allows 60/min, 1,000/hour, 5,000/day on a key prod may share); API.Bible at most 900
// calls in all across NIV, NLT and NKJV (the free plan's 5,000 a month is shared with prod).
// Every call that isn't a cache hit is counted in `calls-<API>.json`, which a rerun resumes from.
// Run NIV, NLT and NKJV one after another: they share one count.
// Run single-verse checks on a fresh cache (`npm run db:reset`): they must reach the API.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getBible, popularPassages, resetLocalBibleQuota } from './local';
import { loadSource, OUT_DIR, verseRuns } from './run';

// `parallel`: chapters in flight at once; the per-minute pace holds across them.
const API: Record<string, { name: string; cap: number; perMinute: number; parallel: number }> = {
  ESV: { name: 'ESV', cap: 1_400, perMinute: 8, parallel: 3 },
  NIV: { name: 'API.Bible', cap: 900, perMinute: 30, parallel: 1 },
  NLT: { name: 'API.Bible', cap: 900, perMinute: 30, parallel: 1 },
  NKJV: { name: 'API.Bible', cap: 900, perMinute: 30, parallel: 1 },
};

// Single-verse path checks: psalm titles, a stanza start, verses some translations omit, poetry.
const SINGLE = [
  'Psalms 3:1', 'Psalms 23:1', 'Psalms 46:1', 'Psalms 51:1', 'Psalms 90:1', 'Psalms 119:1', 'Psalms 119:105',
  'Matthew 18:11', 'Mark 9:44', 'Acts 8:37', 'John 3:16', 'Song of Solomon 1:2', '1 Corinthians 13:4', 'Genesis 1:1',
];

// Sample chapters: every book's first, the suggested passages, and chapters at risk.
const RISKY_CHAPTERS = [
  'Psalms 3', 'Psalms 18', 'Psalms 23', 'Psalms 46', 'Psalms 51', 'Psalms 90', 'Psalms 119', 'Psalms 150',
  'Song of Solomon 1', 'Song of Solomon 2', 'Lamentations 3',
  'Matthew 17', 'Matthew 18', 'Matthew 23', 'Mark 7', 'Mark 9', 'Mark 11', 'Mark 15', 'Mark 16', 'Luke 17',
  'Luke 23', 'John 5', 'John 7', 'John 8', 'Acts 8', 'Acts 15', 'Acts 24', 'Acts 28', 'Romans 16', '1 John 5',
  'Numbers 1', 'Numbers 2', 'Numbers 3', 'Numbers 7', 'Numbers 26', 'Numbers 31', 'Ezra 2', 'Ezra 8',
  'Nehemiah 7', 'Nehemiah 11', '1 Chronicles 5', '1 Chronicles 6', '1 Chronicles 7', '1 Chronicles 12',
  '1 Chronicles 27', '2 Chronicles 2', 'Genesis 5', 'Genesis 11', 'Revelation 7', 'Revelation 21',
  'John 21', 'Acts 2', 'Judges 7', '1 Kings 4', 'Daniel 9', 'Esther 1', 'Esther 9', 'Ezekiel 40', 'Ezekiel 48',
];
const SAMPLE_SIZE = 270;

// Calls start at most `perMinute` a minute, however long each takes and however many are in flight.
let lastStart = 0;
let turn = Promise.resolve();
function pace(perMinute: number): Promise<void> {
  turn = turn
    .then(() => new Promise((r) => setTimeout(r, Math.max(0, lastStart + 60_000 / perMinute - Date.now()))))
    .then(() => {
      lastStart = Date.now();
    });
  return turn;
}
const readJson = <T>(file: string, empty: T): T => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty);

function chapterList(mode: string): { chapter: string; expected: number }[] {
  const counts = new Map<string, number>();
  for (const run of verseRuns(loadSource('KJV'))) counts.set(`${run.book} ${run.chapter}`, run.verses.at(-1)!.verse);
  const all = [...counts.keys()];
  if (mode === 'all') return all.map((chapter) => ({ chapter, expected: counts.get(chapter)! }));
  const picked = new Set<string>();
  for (const book of new Set(all.map((c) => c.replace(/ \d+$/, '')))) picked.add(`${book} 1`);
  for (const p of popularPassages()) picked.add(p.replace(/:.*$/, ''));
  for (const c of RISKY_CHAPTERS) picked.add(c);
  const rest = all.filter((c) => !picked.has(c));
  const step = rest.length / Math.max(1, SAMPLE_SIZE - picked.size);
  for (let i = 0; picked.size < SAMPLE_SIZE && i < rest.length; i += step) picked.add(rest[Math.floor(i)]);
  return all.filter((c) => picked.has(c)).map((chapter) => ({ chapter, expected: counts.get(chapter)! }));
}

async function main() {
  const version = process.argv[2];
  const api = API[version];
  if (!api) throw new Error('Usage: fetch-licensed.ts <ESV|NIV|NLT|NKJV> [--chapters all|sample]');
  const mode = process.argv.includes('--chapters') ? process.argv[process.argv.indexOf('--chapters') + 1] : 'sample';
  if (process.argv.includes('--list')) {
    const chapters = chapterList(mode);
    console.log(`${chapters.map((c) => c.chapter).join(', ')}\n${chapters.length} chapters, ${chapters.reduce((n, c) => n + c.expected, 0)} verses`);
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const files = {
    verses: join(OUT_DIR, `${version}.json`),
    fetch: join(OUT_DIR, `${version}-fetch.json`),
    single: join(OUT_DIR, `${version}-single.json`),
    calls: join(OUT_DIR, `calls-${api.name}.json`),
  };
  const verses = readJson<Record<string, string>>(files.verses, {});
  const fetched = readJson<Record<string, { expected: number; returned: string[]; via: string }>>(files.fetch, {});
  const single = readJson<Record<string, string | null>>(files.single, {});
  const calls = readJson<Record<string, number>>(files.calls, {});
  const save = () => {
    writeFileSync(files.verses, JSON.stringify(verses, null, 1));
    writeFileSync(files.fetch, JSON.stringify(fetched, null, 1));
    writeFileSync(files.single, JSON.stringify(single, null, 1));
    writeFileSync(files.calls, JSON.stringify(calls, null, 1));
  };

  // One function call; counts it against the API's cap unless the function served its cache.
  // Calls in flight count against the cap until they come back as a cache hit.
  let inFlight = 0;
  async function bible(query: string) {
    await pace(api.perMinute);
    if ((calls[api.name] ?? 0) + inFlight >= api.cap) return undefined;
    inFlight++;
    try {
      let res = await getBible(`${query}&version=${version}`);
      if (res.status === 429) {
        await resetLocalBibleQuota();
        res = await getBible(`${query}&version=${version}`);
      }
      if (res.status === 401 || res.status === 429) throw new Error(`bible function ${res.status}`);
      if (!res.body.cached) calls[api.name] = (calls[api.name] ?? 0) + 1;
      return res;
    } finally {
      inFlight--;
    }
  }

  for (const ref of SINGLE) {
    if (typeof single[ref] === 'string') continue;
    const res = await bible(`ref=${encodeURIComponent(ref)}`);
    if (!res) break;
    if (res.body.cached) console.log(`${ref}: served from cache, so this isn't the single-verse path. Reset the DB first.`);
    single[ref] = res.status === 200 ? (res.body.text ?? '') : null;
    save();
  }

  const chapters = chapterList(mode);
  const queue = chapters.filter(({ chapter }) => !fetched[chapter] || fetched[chapter].via.startsWith('error'));
  let done = chapters.length - queue.length;
  let capped = false;
  const fetchChapters = async () => {
    while (queue.length && !capped) {
      const { chapter, expected } = queue.shift()!;
      done++;
      const res = await bible(`ref=${encodeURIComponent(chapter)}&chapter=true`);
      if (!res) {
        capped = true;
        console.log(`${api.name} cap of ${api.cap} calls reached; stopping.`);
        break;
      }
      const keyed = res.status === 200 ? (res.body.verses ?? {}) : {};
      fetched[chapter] = { expected, returned: Object.keys(keyed), via: res.status === 200 ? 'chapter' : `error ${res.status}` };
      for (const [v, text] of Object.entries(keyed)) verses[`${chapter}:${v}`] = text;
      // One-chapter books the chapter path can't serve (ESV reads "Jude 1" as Jude verse 1): fetch
      // each verse on the single-verse path, as a reader adding one verse would.
      if (expected > 1 && Object.keys(keyed).length <= 1 && /^(Obadiah|Philemon|2 John|3 John|Jude) 1$/.test(chapter)) {
        fetched[chapter].via = 'single verses';
        for (let v = 1; v <= expected + 1; v++) {
          const one = await bible(`ref=${encodeURIComponent(`${chapter}:${v}`)}`);
          if (!one) break;
          if (one.status === 200 && one.body.text) verses[`${chapter}:${v}`] = one.body.text;
        }
      }
      save();
      if (done % 20 === 0) console.log(`${done}/${chapters.length} chapters, ${calls[api.name]} ${api.name} calls`);
    }
  };
  await Promise.all(Array.from({ length: api.parallel }, fetchChapters));
  save();
  console.log(`${version}: ${Object.keys(fetched).length} chapters, ${Object.keys(verses).length} verses; ${calls[api.name] ?? 0} ${api.name} calls in all`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
