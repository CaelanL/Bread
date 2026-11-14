// RC5 in docs/grading-audit.md: the ESV text Bread grades against, fetched through the LOCAL
// `bible` function and checked against the same verses from the chapter path. What a verse
// holds depends on which request first filled the local verse_cache, so start from a fresh one:
//
//   npm run db:reset && npx tsx scripts/grading-audit/esv-text.ts
//
// Prints references, counts and scores only; the licensed text stays in memory.
import { alignTranscription } from '../../lib/align';
import { getBible } from './local';
import { judge } from './run';
import { engineStyle } from './variations';

// Single verses that open with a psalm title or a Psalm 119 stanza letter on the single-verse path.
const TITLED = ['Psalms 46:1', 'Psalms 23:1', 'Psalms 119:105', 'Psalms 51:1'];
// Verses the ESV omits; the single-verse path returns their neighbours.
const OMITTED = ['Matthew 18:11', 'Mark 9:44'];
// Ranges in one-chapter books; the range path returns verse 1 or nothing.
const ONE_CHAPTER = ['Jude 1:24-25', 'Philemon 1:1-7'];

async function esv(query: string) {
  const { status, body } = await getBible(`${query}&version=ESV`);
  if (status !== 200) throw new Error(`${query}: ${status} ${body.error ?? ''}`);
  return body;
}

function parse(ref: string) {
  const m = ref.match(/^(.+) (\d+):(\d+)(?:-(\d+))?$/)!;
  return { chapter: `${m[1]} ${m[2]}`, start: Number(m[3]), end: Number(m[4] ?? m[3]) };
}

const chapterVerses = async (chapter: string) =>
  (await esv(`ref=${encodeURIComponent(chapter)}&chapter=true`)).verses ?? {};

async function main() {
  for (const ref of TITLED) {
    const single = await esv(`ref=${encodeURIComponent(ref)}`);
    const { chapter, start } = parse(ref);
    const truth = (await chapterVerses(chapter))[String(start)];
    // A reader saying the verse as an ESV Bible prints it, graded against what the app was served.
    const v = judge(alignTranscription, single.text ?? '', engineStyle(truth));
    const cached = single.cached ? ' (served from cache: run npm run db:reset first)' : '';
    console.log(`${ref}: correct recitation scores ${v.score}%, ${v.missing.length} served words not in the verse${cached}`);
  }

  for (const ref of OMITTED) {
    const single = await esv(`ref=${encodeURIComponent(ref)}`);
    const { chapter, start } = parse(ref);
    const verses = await chapterVerses(chapter);
    const neighbours = [verses[String(start - 1)], verses[String(start + 1)]].join(' ');
    const v = judge(alignTranscription, single.text ?? '', engineStyle(neighbours));
    console.log(
      `${ref}: chapter has this verse: ${String(start) in verses}; single fetch returned ${single.text?.split(/\s+/).length ?? 0} words, ` +
        `matching verses ${start - 1} and ${start + 1} at ${v.score}%`,
    );
  }

  for (const ref of ONE_CHAPTER) {
    const { start, end } = parse(ref);
    const range = await esv(`ref=${encodeURIComponent(ref)}`);
    const keyed = Object.keys(range.verses ?? {});
    console.log(`${ref}: ${keyed.length} of ${end - start + 1} verses returned (keys: ${keyed.join(', ') || 'none'})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
