// Fetches a licensed translation through the LOCAL `bible` function into
// `.expo/grading-audit/<VERSION>.json` (gitignored; never commit licensed text).
// Single-verse refs take the function's single-verse path, so the sample holds whatever that
// path returns, psalm titles included (RC5 in docs/grading-audit.md; check with esv-text.ts).
//
//   npx tsx scripts/grading-audit/fetch-licensed.ts ESV
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getBible, popularPassages } from './local';
import { OUT_DIR } from './run';

// Passages chosen for risk: numbers, verses some translations omit, hyphens and possessives.
const RISKY = [
  'Genesis 5:3-8', 'Genesis 14:14', 'Numbers 1:20-27', 'Ezra 2:1-15', 'Judges 7:6-7', '1 Kings 4:26',
  'Matthew 18:21-22', 'John 21:11', 'Acts 2:41', 'John 6:10', 'Luke 15:4-7', 'Revelation 7:4-8',
  'Revelation 13:18', 'Matthew 17:20-22', 'Matthew 18:10-12', 'Mark 9:43-48', 'Acts 8:36-38',
  'John 5:3-5', 'Romans 16:23-25', 'Luke 17:35-37', 'Psalms 90:10', 'Daniel 9:25-26', 'Esther 1:1',
  'Genesis 50:22-26', 'Ruth 1:16-17', 'Psalms 23:1-6',
];

async function main() {
  const version = process.argv[2];
  if (!version || version === 'KJV') throw new Error('Usage: fetch-licensed.ts <ESV|NLT|NIV|NKJV>');
  const file = join(OUT_DIR, `${version}.json`);
  const out: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const missingVerses: string[] = [];

  for (const ref of [...new Set([...popularPassages(), ...RISKY])]) {
    const m = ref.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/)!;
    const [book, chapter, start, end] = [m[1], m[2], Number(m[3]), Number(m[4] ?? m[3])];
    if (Array.from({ length: end - start + 1 }, (_, i) => `${book} ${chapter}:${start + i}`).every((k) => k in out)) continue;
    const { status, body } = await getBible(`ref=${encodeURIComponent(ref)}&version=${version}`);
    if (status === 429) {
      console.log('Every seed user hit the daily Bible quota; saving what was fetched.');
      break;
    }
    if (status !== 200) {
      console.log(`${ref}: ${status} ${body.error ?? ''}`);
      continue;
    }
    const keyed: Record<string, string> = body.verses ?? (body.text ? { [start]: body.text } : {});
    for (let v = start; v <= end; v++) {
      if (keyed[String(v)] === undefined) missingVerses.push(`${book} ${chapter}:${v}`);
      else out[`${book} ${chapter}:${v}`] = keyed[String(v)];
    }
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${Object.keys(out).length} ${version} verses in ${file}`);
  if (missingVerses.length) console.log(`No keyed text returned for: ${missingVerses.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
