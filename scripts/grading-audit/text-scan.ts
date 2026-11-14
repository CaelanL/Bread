// What a fetched licensed translation's text holds that grading can trip on (RC5, RC7 in
// docs/grading-audit.md). Reads what fetch-licensed.ts saved and prints counts and references
// only, never the text.
//
//   npx tsx scripts/grading-audit/text-scan.ts <ESV|NIV|NLT|NKJV> [--examples N]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findNumberSpans } from './numbers';
import { loadSource, OUT_DIR } from './run';

const version = process.argv[2];
const examples = Number(process.argv[process.argv.indexOf('--examples') + 1]) || 8;
const read = <T>(name: string, empty: T): T => {
  const file = join(OUT_DIR, `${version}${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : empty;
};
const verses = read<Record<string, string>>('', {});
const fetched = read<Record<string, { expected: number; returned: string[]; via: string }>>('-fetch', {});
const single = read<Record<string, string | null>>('-single', {});
const kjv = loadSource('KJV');

const words = (t: string) => t.split(/\s+/).filter(Boolean);
const found: Record<string, string[]> = {};
const note = (what: string, ref: string) => (found[what] ??= []).push(ref);

// ---------- coverage ----------
let expected = 0;
for (const [chapter, f] of Object.entries(fetched)) {
  expected += f.expected;
  if (f.via !== 'chapter') note(`chapter not served by the chapter path (${f.via})`, chapter);
  const keys = new Set(Object.keys(verses).filter((k) => k.startsWith(`${chapter}:`)).map((k) => Number(k.split(':')[1])));
  for (let v = 1; v <= f.expected; v++) {
    if (keys.has(v)) continue;
    note('verse missing (KJV numbering)', `${chapter}:${v}`);
    // The text of a missing verse may sit in its neighbour: much longer than the KJV verse.
    const prev = verses[`${chapter}:${v - 1}`];
    const kjvPrev = kjv[`${chapter}:${v - 1}`];
    if (prev && kjvPrev && words(prev).length > words(kjvPrev).length * 1.6 + 4) note('missing verse, previous verse long enough to hold it', `${chapter}:${v}`);
  }
  for (const v of keys) if (v > f.expected) note('verse beyond the KJV count', `${chapter}:${v}`);
}

// Two words glued with no punctuation between ("bonesand"): a word seen once in this text and
// the KJV that splits into a common word and a short function word. A heuristic, a few false hits.
const freq = new Map<string, number>();
for (const t of [...Object.values(verses), ...Object.values(kjv)]) {
  for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) freq.set(w, (freq.get(w) ?? 0) + 1);
}
const FUNCTION_WORDS = new Set('and the of to in for who but or as with when will is are be my your his her their you he she they we that so all not from on at by'.split(' '));
const gluedPlain = (w: string) => {
  if ((freq.get(w) ?? 0) > 1) return false;
  for (let i = 1; i < w.length; i++) {
    const [a, b] = [w.slice(0, i), w.slice(i)];
    if ((FUNCTION_WORDS.has(a) && b.length > 2 && (freq.get(b) ?? 0) >= 5) || (FUNCTION_WORDS.has(b) && a.length > 2 && (freq.get(a) ?? 0) >= 5)) return true;
  }
  return false;
};

// ---------- per verse ----------
const TITLE = /^(A Psalm|A Song|A Maskil|A Miktam|A Prayer|A Shiggaion|To the choirmaster|For the director of music|To the Chief Musician|For the choir director|Of David|Of Asaph|Of the Sons of Korah|A psalm|A song|A maskil|A prayer|A David)/;
// Stanza letter names that aren't also English words (He, Pe, Sin, Mem, Nun are left out).
const HEBREW_LETTERS = /^(Aleph|Alef|Beth|Gimel|Daleth|Dalet|Waw|Vav|Zayin|Heth|Teth|Yodh|Kaph|Lamedh|Lamed|Samekh|Ayin|Tsadhe|Tsadde|Qoph|Resh|Shin|Taw|Tav)$/;
const CONTRACTION = /\b[A-Za-z]+n['’]t\b|\b[A-Za-z]+['’](ll|re|ve|m|d)\b|\b(it|that|there|here|he|she|what|who|where|let|how|when)['’]s\b/gi;
const chars: Record<string, number> = {};
const contractions: Record<string, number> = {};
let withDigits = 0;
let withNumberWords = 0;
let withContractions = 0;

for (const [ref, text] of Object.entries(verses)) {
  if (!text.trim()) note('empty verse text', ref);
  const k = kjv[ref];
  if (k && words(text).length > words(k).length * 2 + 8) note('verse more than twice the KJV length (neighbour or note?)', ref);
  if (k && words(text).length * 3 + 3 < words(k).length) note('verse under a third of the KJV length (split or cut?)', ref);
  for (const ch of text.replace(/[A-Za-z0-9 ]/g, '')) chars[ch] = (chars[ch] ?? 0) + 1;
  if (/[a-z][.,;:!?][A-Za-z]/.test(text)) note('words glued across punctuation (tag removed without a space)', ref);
  if ((text.match(/(?<![A-Za-z'’])[A-Za-z]+(?![A-Za-z'’])/g) ?? []).some((w) => gluedPlain(w.toLowerCase()))) {
    note('two words glued with no punctuation between (heuristic)', ref);
  }
  if (/&#?\w+;/.test(text)) note('HTML entity in text', ref);
  if (/[<>]/.test(text)) note('angle bracket (leftover tag) in text', ref);
  if (/[[\]{}]/.test(text)) note('square or curly bracket in text', ref);
  if (/[()]/.test(text)) note('parentheses in text', ref);
  if (/[*†‡§¶#+|^~_\\]/.test(text)) note('footnote or marker character in text', ref);
  if (/[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(text)) note('superscript digit in text', ref);
  if (/:1$/.test(ref) && ref.startsWith('Psalms') && TITLE.test(text)) note('psalm title inside verse 1', ref);
  const w = words(text);
  if (/[\u05D0-\u05EA]/.test(text) || (w.some((x) => HEBREW_LETTERS.test(x.replace(/[^A-Za-z]/g, ''))) && /^(Psalms 119|Lamentations)/.test(ref))) {
    note('Hebrew letter or letter name in the text (stanza label)', ref);
  }
  // A capitalised word after the sentence has ended: a label, stanza letter or note.
  const last = w.at(-1) ?? '';
  if (w.length > 2 && /[.!?”’"']$/.test(w.at(-2)!) && /^[A-Z]/.test(last) && !/[.!?,;:”’"')]$/.test(last) && !/^(Selah|Interlude)/.test(last)) {
    note('word after the closing punctuation (label, stanza letter or note?)', ref);
  }
  if (/\d/.test(text)) withDigits++;
  if (findNumberSpans(w).length) withNumberWords++;
  const c = text.match(CONTRACTION);
  if (c) {
    withContractions++;
    for (const m of c) contractions[m.toLowerCase().replace(/’/g, "'")] = (contractions[m.toLowerCase().replace(/’/g, "'")] ?? 0) + 1;
  }
}

// ---------- single-verse path against the chapter path ----------
for (const [ref, text] of Object.entries(single)) {
  const chapter = verses[ref];
  if (text === null) note('single-verse path: error', ref);
  else if (chapter === undefined) note(`single-verse path returned ${words(text).length} words for a verse the chapter path lacks`, ref);
  else if (words(text).join(' ') === words(chapter).join(' ')) note('single-verse path: same as the chapter path', ref);
  else if (words(text).join(' ').endsWith(words(chapter).join(' '))) note(`single-verse path: chapter text plus words before it (title?)`, ref);
  else note('single-verse path: differs from the chapter path', ref);
}

const totalExpected = expected;
console.log(`${version}: ${Object.keys(fetched).length} chapters, ${Object.keys(verses).length} verses returned of ${totalExpected} expected (KJV numbering)`);
console.log(`verses with digits ${withDigits}, with number words ${withNumberWords}, with contractions ${withContractions}`);
console.log(`contractions: ${Object.entries(contractions).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ') || 'none'}`);
console.log(`characters besides letters, digits and space: ${Object.entries(chars).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${JSON.stringify(c)} U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} ${n}`).join(', ')}`);
for (const [what, refs] of Object.entries(found).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(refs.length).padStart(6)}  ${what}: ${refs.slice(0, examples).join(', ')}${refs.length > examples ? ', ...' : ''}`);
}
