// Captures what Crossway and API.Bible send for the layouts that broke grading (psalm titles,
// stanzas, speaker labels, notes, merged rows, omitted verses, one-chapter books, fractions),
// asked the way each `bible` adapter asks, straight from the APIs with the local keys. Raw
// responses go to gitignored `.expo/grading-audit/raw/`, one file per call, for building the
// adapters' synthetic test fixtures. Licensed text: never commit or print it.
//
//   npx tsx scripts/grading-audit/capture-raw.ts [--list]
//
// Hard caps (Caelan's budget, 2026-11-14): 60 Crossway and 100 API.Bible calls. A file already
// captured is not fetched again, and every call is counted in raw/calls.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { OUT_DIR } from './run';

const RAW = join(OUT_DIR, 'raw');
const CAPS: Record<string, number> = { crossway: 60, apibible: 100 };

const CHAPTERS = [
  'Psalms 3', 'Psalms 23', 'Psalms 46', 'Psalms 51', 'Psalms 90', 'Psalms 119', 'Song of Solomon 1',
  'Song of Solomon 2', 'Matthew 18', 'Mark 9', 'Mark 16', 'John 7', 'Acts 8', 'Jude 1', 'Philemon 1',
  'Obadiah 1', '2 John 1', '3 John 1', 'Habakkuk 3', 'Numbers 1', 'Numbers 2', 'Exodus 26', 'Ezekiel 40',
];
const VERSES = ['Psalms 3:1', 'Psalms 23:1', 'Psalms 119:1', 'Psalms 119:105', 'Matthew 18:11', 'Jude 1:26'];
const ONE_CHAPTER: Record<string, number> = { Jude: 25, Philemon: 25, Obadiah: 21, '2 John': 13, '3 John': 14 };

const BIBLE_IDS: Record<string, string> = { NLT: 'd6e14a625393b4da-01', NIV: '78a9f6124f344018-01', NKJV: '63097d2a0a2f7db3-01' };
const BOOK_IDS: Record<string, string> = {
  Psalms: 'PSA', 'Song of Solomon': 'SNG', Matthew: 'MAT', Mark: 'MRK', John: 'JHN', Acts: 'ACT', Jude: 'JUD',
  Philemon: 'PHM', Obadiah: 'OBA', '2 John': '2JN', '3 John': '3JN', Habakkuk: 'HAB', Numbers: 'NUM',
  Exodus: 'EXO', Ezekiel: 'EZK',
};

function key(name: string): string {
  const line = readFileSync(join(__dirname, '../../supabase/functions/.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).replace(/^["']|["']$/g, '').trim();
  if (!value) throw new Error(`${name} missing from supabase/functions/.env`);
  return value;
}

// The params each adapter sends (supabase/functions/bible/adapters/).
const ESV_COMMON = {
  'include-passage-references': 'false',
  'include-footnotes': 'false',
  'include-footnote-body': 'false',
  'include-headings': 'false',
  'include-short-copyright': 'false',
  'include-selahs': 'true',
  'indent-paragraphs': '0',
  'indent-poetry': 'false',
};
const esvNumbered = { ...ESV_COMMON, 'include-verse-numbers': 'true', 'include-first-verse-numbers': 'true' };
const esvPlain = { ...ESV_COMMON, 'include-verse-numbers': 'false', 'include-first-verse-numbers': 'false' };
const apiHtml = {
  'content-type': 'html',
  'include-notes': 'false',
  'include-titles': 'false',
  'include-chapter-numbers': 'false',
  'include-verse-numbers': 'true',
  'include-verse-spans': 'true',
};

interface Call {
  api: 'crossway' | 'apibible';
  file: string;
  url: string;
  headers: Record<string, string>;
}

function apiRef(ref: string): string {
  const m = ref.match(/^(.+?) (\d+)(?::(\d+))?$/)!;
  return [BOOK_IDS[m[1]], m[2], m[3]].filter(Boolean).join('.');
}

function plan(): Call[] {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_');
  const esv = (ref: string, kind: string, params: Record<string, string>): Call => ({
    api: 'crossway',
    file: `ESV-${kind}-${slug(ref)}.json`,
    url: `https://api.esv.org/v3/passage/text/?${new URLSearchParams({ q: ref, ...params })}`,
    headers: { Authorization: `Token ${key('ESV_API_KEY')}` },
  });
  const api = (version: string, ref: string, path: 'chapters' | 'passages'): Call => ({
    api: 'apibible',
    file: `${version}-${path}-${slug(ref)}.json`,
    url: `https://rest.api.bible/v1/bibles/${BIBLE_IDS[version]}/${path}/${apiRef(ref)}?${new URLSearchParams(apiHtml)}`,
    headers: { 'api-key': key('API_BIBLE_KEY') },
  });
  const calls: Call[] = [];
  for (const ref of CHAPTERS) calls.push(esv(ref, 'chapter', esvNumbered));
  for (const [book, count] of Object.entries(ONE_CHAPTER)) calls.push(esv(`${book} 1:1-${count}`, 'chapter', esvNumbered));
  for (const ref of VERSES) calls.push(esv(ref, 'verse-plain', esvPlain), esv(ref, 'verse-numbered', esvNumbered));
  for (const version of Object.keys(BIBLE_IDS)) {
    for (const ref of CHAPTERS) calls.push(api(version, ref, 'chapters'));
    for (const ref of VERSES) calls.push(api(version, ref, 'passages'));
  }
  return calls;
}

async function main() {
  const calls = plan();
  if (process.argv.includes('--list')) {
    for (const c of calls) console.log(c.api, c.file);
    console.log(calls.filter((c) => c.api === 'crossway').length, 'Crossway,', calls.filter((c) => c.api === 'apibible').length, 'API.Bible');
    return;
  }
  mkdirSync(RAW, { recursive: true });
  const countFile = join(RAW, 'calls.json');
  const count: Record<string, number> = existsSync(countFile) ? JSON.parse(readFileSync(countFile, 'utf8')) : { crossway: 0, apibible: 0 };
  for (const call of calls) {
    const file = join(RAW, call.file);
    if (existsSync(file)) continue;
    if (count[call.api] >= CAPS[call.api]) throw new Error(`${call.api} cap of ${CAPS[call.api]} calls reached`);
    count[call.api]++;
    writeFileSync(countFile, JSON.stringify(count));
    const res = await fetch(call.url, { headers: call.headers });
    writeFileSync(file, JSON.stringify({ status: res.status, body: await res.text() }));
    console.log(`${res.status} ${call.file}`);
    await new Promise((r) => setTimeout(r, call.api === 'crossway' ? 1_100 : 500)); // Crossway allows 60 a minute
  }
  console.log(`calls so far: ${count.crossway} Crossway, ${count.apibible} API.Bible`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
