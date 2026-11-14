// Ways a speech engine can write down a correct recitation. Each pass returns the verse
// text the app scores against (`expected`) and the transcript, or null when the pass has
// nothing to change in this chunk, so its counts cover only chunks it touched.
import { toDigits, type NumberForm } from './numbers';

export interface Case {
  expected: string;
  transcript: string;
}

export interface ChunkRef {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  verseTexts: { verse: number; text: string }[];
}

export interface Pass {
  name: string;
  group: 'baseline' | 'numbers' | 'spelling' | 'homophone' | 'compound' | 'unicode' | 'speech' | 'reference' | 'live';
  make(text: string, ref: ChunkRef): Case | null;
}

// Lowercase, dashes to spaces, punctuation gone except apostrophes and digit separators.
export function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/[—–―‐‑‒−-]/g, ' ')
    .replace(/(\d)([,:])(?=\d)/g, '$1\u0000$2')
    .replace(/[^a-z0-9'\s\u0000]/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/(^|\s)'+|'+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const plain = (text: string) => clean(text).replace(/'/g, '');

// Roughly what an engine prints: straight quotes, sentence capitals, commas and periods,
// "LORD" as "Lord", no brackets or quote marks.
export function engineStyle(text: string): string {
  const words = text
    .replace(/[’‘]/g, "'")
    .replace(/[—–]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let capital = true;
  const out: string[] = [];
  for (let raw of words) {
    raw = raw.replace(/["“”()[\]]/g, '').replace(/^'+/, '').replace(/[;:]$/, ',');
    if (!raw || /^[^A-Za-z0-9]+$/.test(raw)) continue;
    const letters = raw.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 2 && letters === letters.toUpperCase()) {
      raw = raw.charAt(0) + raw.slice(1).toLowerCase();
    }
    if (capital) raw = raw.charAt(0).toUpperCase() + raw.slice(1);
    capital = /[.?!]$/.test(raw);
    out.push(raw);
  }
  const joined = out.join(' ');
  return /[.?!]$/.test(joined) ? joined : `${joined.replace(/,$/, '')}.`;
}

// Whole-word replacements on the cleaned transcript. Returns null if none applied.
function replaceWords(text: string, map: [RegExp, string][]): Case | null {
  let transcript = clean(text);
  const before = transcript;
  for (const [re, to] of map) transcript = transcript.replace(re, to);
  return transcript === before ? null : { expected: text, transcript };
}

const stemMap = (pairs: [string, string][]): [RegExp, string][] =>
  pairs.map(([from, to]) => [new RegExp(`\\b${from}(?=[a-z']*\\b)`, 'g'), to]);
const wordMap = (pairs: [string, string][]): [RegExp, string][] =>
  pairs.map(([from, to]) => [new RegExp(`\\b${from}\\b`, 'g'), to]);

const AMERICAN = [
  ...stemMap([
    ['honour', 'honor'], ['dishonour', 'dishonor'], ['neighbour', 'neighbor'], ['labour', 'labor'],
    ['fellowlabour', 'fellowlabor'], ['favour', 'favor'], ['wellfavour', 'wellfavor'], ['savour', 'savor'],
    ['valour', 'valor'], ['armour', 'armor'], ['colour', 'color'], ['rumour', 'rumor'], ['odour', 'odor'],
    ['rigour', 'rigor'], ['parlour', 'parlor'], ['vapour', 'vapor'], ['succour', 'succor'],
    ['endeavour', 'endeavor'], ['clamour', 'clamor'],
    ['sepulchre', 'sepulcher'], ['sceptre', 'scepter'], ['mitre', 'miter'], ['nitre', 'niter'], ['theatre', 'theater'],
    ['marvell', 'marvel'], ['travell', 'travel'], ['counsell', 'counsel'], ['apparell', 'apparel'],
    ['caterpiller', 'caterpillar'], ['plough', 'plow'], ['mould', 'mold'],
  ]),
  ...wordMap([
    ['defence', 'defense'], ['defences', 'defenses'], ['offence', 'offense'], ['offences', 'offenses'],
    ['pretence', 'pretense'], ['fulfil', 'fulfill'],
  ]),
];

// Older spellings of a word said the same way today.
const MODERN = [
  ...stemMap([
    ['shew', 'show'], ['intreat', 'entreat'], ['enquir', 'inquir'], ['stedfast', 'steadfast'],
    ['plaister', 'plaster'], ['asswag', 'assuag'], ['loth', 'loath'], ['brasen', 'brazen'],
    ['grisled', 'grizzled'], ['chesnut', 'chestnut'], ['musick', 'music'], ['publick', 'public'],
    ['ancle', 'ankle'], ['bason', 'basin'], ['cieled', 'ceiled'], ['cieling', 'ceiling'], ['spue', 'spew'],
  ]),
  ...wordMap([
    ['vail', 'veil'], ['vails', 'veils'], ['sope', 'soap'], ['morter', 'mortar'], ['cloke', 'cloak'],
    ['subtil', 'subtle'], ['subtilty', 'subtlety'], ['subtilly', 'subtly'], ['hungred', 'hungered'],
    ['rereward', 'rearward'], ['nought', 'naught'],
  ]),
];

// True homophones: the engine cannot tell them apart from sound alone.
export const HOMOPHONES: [string, string][] = [
  ['son', 'sun'], ['sun', 'son'], ['holy', 'wholly'], ['wholly', 'holy'], ['reign', 'rain'],
  ['rain', 'reign'], ['prey', 'pray'], ['pray', 'prey'], ['their', 'there'], ['there', 'their'],
  ['too', 'to'], ['for', 'four'], ['four', 'for'], ['knew', 'new'], ['new', 'knew'],
  ['know', 'no'], ['no', 'know'], ['right', 'write'], ['write', 'right'], ['soul', 'sole'],
  ['whole', 'hole'], ['hear', 'here'], ['here', 'hear'], ['by', 'buy'], ['mourning', 'morning'],
  ['peace', 'piece'], ['altar', 'alter'], ['sow', 'so'], ['so', 'sow'], ['way', 'weigh'],
  ['meat', 'meet'], ['meet', 'meat'], ['vain', 'vein'], ['made', 'maid'], ['one', 'won'],
  ['eight', 'ate'], ['ate', 'eight'], ['wood', 'would'], ['threw', 'through'], ['flour', 'flower'],
  ['hour', 'our'], ['our', 'hour'], ['be', 'bee'], ['sea', 'see'], ['see', 'sea'], ['bare', 'bear'],
  ['bear', 'bare'], ['seen', 'scene'], ['heard', 'herd'], ['herd', 'heard'], ['tale', 'tail'],
  ['sent', 'scent'], ['heal', 'heel'], ['steal', 'steel'], ['need', 'knead'], ['led', 'lead'],
  ['lo', 'low'], ['aught', 'ought'], ['nay', 'neigh'], ['rest', 'wrest'], ['abel', 'able'],
  ['cain', 'cane'], ['nought', 'naught'], ['praise', 'prays'], ['raise', 'rays'], ['to', 'two'],
];

const JOIN = wordMap([
  ['for ever', 'forever'], ['to day', 'today'], ['to morrow', 'tomorrow'], ['any thing', 'anything'],
  ['every thing', 'everything'], ['some thing', 'something'], ['every one', 'everyone'],
  ['any one', 'anyone'], ['every where', 'everywhere'], ['some times', 'sometimes'],
  ['mean while', 'meanwhile'], ['any more', 'anymore'], ['no where', 'nowhere'], ['in to', 'into'],
]);
const SPLIT = wordMap([
  ['forasmuch', 'for as much'], ['inasmuch', 'in as much'], ['insomuch', 'in so much'],
  ['nevertheless', 'never the less'], ['notwithstanding', 'not with standing'],
  ['whatsoever', 'what so ever'], ['whosoever', 'who so ever'], ['whomsoever', 'whom so ever'],
  ['wheresoever', 'where so ever'], ['howbeit', 'how be it'], ['wherewith', 'where with'],
  ['wherefore', 'where fore'], ['therefore', 'there fore'], ['herein', 'here in'],
  ['therein', 'there in'], ['thereof', 'there of'], ['whereof', 'where of'], ['wherein', 'where in'],
  ['hereafter', 'here after'], ['thereby', 'there by'], ['whereby', 'where by'], ['withal', 'with all'],
  ['himself', 'him self'], ['themselves', 'them selves'], ['yourselves', 'your selves'],
]);

// Characters a non-KJV source can put in the verse text. The transcript stays plain.
function unicodePass(name: string, edit: (text: string) => string): Pass {
  return {
    name: `unicode:${name}`,
    group: 'unicode',
    make(text) {
      const expected = edit(text);
      return expected === text ? null : { expected, transcript: plain(text) };
    },
  };
}

const longWords = (text: string, insert: string) =>
  text.replace(/\b([A-Za-z]{3})([A-Za-z]{4,})\b/g, `$1${insert}$2`);

function digitsPass(name: string, pick: (forms: Set<NumberForm>) => boolean): Pass {
  return {
    name,
    group: 'numbers',
    make(text) {
      const { text: digits, changed } = toDigits(text, pick);
      return changed ? { expected: text, transcript: engineStyle(digits) } : null;
    },
  };
}

function words(text: string): string[] {
  return plain(text).split(' ').filter(Boolean);
}

function insertAt(text: string, index: number, insert: string): string {
  const w = words(text);
  const at = Math.min(index, w.length);
  return [...w.slice(0, at), insert, ...w.slice(at)].join(' ');
}

const BOOK_DIGITS: Record<string, string> = { '1': 'first', '2': 'second', '3': 'third' };
function spokenReference(ref: ChunkRef): string {
  const verses = ref.verseEnd !== ref.verseStart ? `${ref.verseStart}-${ref.verseEnd}` : `${ref.verseStart}`;
  return `${ref.book} ${ref.chapter}:${verses}`;
}

export const FILLER_WORDS = ['um', 'uh', 'hmm', 'uhm', 'erm', 'er', 'ah', 'mm-hmm', 'uh-huh', 'like', 'you know'];

export const PASSES: Pass[] = [
  { name: 'plain', group: 'baseline', make: (t) => ({ expected: t, transcript: plain(t) }) },
  { name: 'engine-style', group: 'baseline', make: (t) => ({ expected: t, transcript: engineStyle(t) }) },

  digitsPass('digits:standard', (f) => !f.has('article') && !f.has('archaic')),
  digitsPass('digits:article', (f) => f.has('article') && !f.has('archaic')),
  digitsPass('digits:archaic', (f) => f.has('archaic')),
  digitsPass('digits:all', () => true),

  { name: 'spelling:american', group: 'spelling', make: (t) => replaceWords(t, AMERICAN) },
  { name: 'spelling:modern', group: 'spelling', make: (t) => replaceWords(t, MODERN) },
  {
    // Names ending in s ("Moses' hands") are often said "Moses's".
    name: 'possessive:name-s-apostrophe-s',
    group: 'spelling',
    make: (t) => {
      const re = /\b([A-Z][a-z]*s)['’](?=\s|$|[,.;:?!])/g;
      return re.test(t) ? { expected: t, transcript: engineStyle(t.replace(re, "$1's")) } : null;
    },
  },
  {
    name: 'possessive:dropped',
    group: 'spelling',
    make: (t) => (/['’]s\b/.test(t) ? { expected: t, transcript: plain(t.replace(/['’]s\b/g, 's')) } : null),
  },

  ...HOMOPHONES.map(([from, to]): Pass => ({
    name: `homophone:${from}>${to}`,
    group: 'homophone',
    make: (t) => replaceWords(t, wordMap([[from, to]])),
  })),

  { name: 'compound:join-open', group: 'compound', make: (t) => replaceWords(t, JOIN) },
  { name: 'compound:split-closed', group: 'compound', make: (t) => replaceWords(t, SPLIT) },
  {
    name: 'compound:join-hyphenated',
    group: 'compound',
    make: (t) => (/[A-Za-z]-[A-Za-z]/.test(t) ? { expected: t, transcript: plain(t.replace(/([A-Za-z])-(?=[A-Za-z])/g, '$1')) } : null),
  },

  unicodePass('curly-quotes', (t) => t.replace(/'/g, '’').replace(/"([^"]*)"/g, '“$1”')),
  unicodePass('modifier-apostrophe', (t) => t.replace(/['’]/g, 'ʼ')),
  unicodePass('prime-apostrophe', (t) => t.replace(/['’]/g, '′')),
  unicodePass('backtick-apostrophe', (t) => t.replace(/['’]/g, '`')),
  unicodePass('hyphen-u2010', (t) => t.replace(/(\w)-(?=\w)/g, '$1‐')),
  unicodePass('hyphen-nonbreaking', (t) => t.replace(/(\w)-(?=\w)/g, '$1‑')),
  unicodePass('hyphen-minus-sign', (t) => t.replace(/(\w)-(?=\w)/g, '$1−')),
  unicodePass('soft-hyphen', (t) => longWords(t, '­')),
  unicodePass('zero-width-space-in-word', (t) => longWords(t, '​')),
  unicodePass('zero-width-joiner-in-word', (t) => longWords(t, '‍')),
  unicodePass('zero-width-space-as-separator', (t) => t.replace(/ (?=\S)/, '​')),
  unicodePass('nbsp-separators', (t) => t.replace(/ /g, ' ')),
  unicodePass('narrow-nbsp-separators', (t) => t.replace(/ /g, ' ')),
  unicodePass('bom-prefix', (t) => `﻿${t}`),
  unicodePass('accented-e-nfc', (t) => t.replace(/\b([A-Z][a-z]*?)e([a-z]+)\b/, '$1é$2')),
  unicodePass('accented-e-nfd', (t) => t.replace(/\b([A-Z][a-z]*?)e([a-z]+)\b/, '$1é$2')),
  unicodePass('html-entity-apostrophe', (t) => t.replace(/['’]/g, '&#8217;')),
  unicodePass('html-entity-named', (t) => t.replace(/['’]/g, '&rsquo;').replace(/—/g, '&mdash;')),
  unicodePass('html-entity-amp-space', (t) => t.replace(/, /, ',&nbsp;')),
  unicodePass('ellipsis-joined', (t) => t.replace(/(\w), (?=\w)/, '$1…')),
  unicodePass('em-dash-joined', (t) => t.replace(/(\w), (?=\w)/, '$1—')),
  unicodePass('horizontal-bar-joined', (t) => t.replace(/(\w), (?=\w)/, '$1―')),
  unicodePass('slash-joined', (t) => t.replace(/(\w), (?=\w)/, '$1/')),
  {
    name: 'unicode:transcript-curly-apostrophe',
    group: 'unicode',
    make: (t) => (/'/.test(t) ? { expected: t, transcript: engineStyle(t).replace(/'/g, '’') } : null),
  },

  {
    name: 'speech:restart-start',
    group: 'speech',
    make: (t) => {
      const w = words(t);
      return w.length < 4 ? null : { expected: t, transcript: [...w.slice(0, 2), ...w].join(' ') };
    },
  },
  {
    name: 'speech:restart-middle',
    group: 'speech',
    make: (t) => {
      const w = words(t);
      if (w.length < 6) return null;
      const mid = Math.floor(w.length / 2);
      return { expected: t, transcript: [...w.slice(0, mid), ...w.slice(mid - 2, mid), ...w.slice(mid)].join(' ') };
    },
  },
  {
    name: 'speech:stutter-word',
    group: 'speech',
    make: (t) => {
      const w = words(t);
      return w.length < 3 ? null : { expected: t, transcript: [w[0], ...w].join(' ') };
    },
  },
  ...FILLER_WORDS.map((filler): Pass => ({
    name: `speech:filler-${filler.replace(' ', '-')}`,
    group: 'speech',
    make: (t) => (words(t).length < 4 ? null : { expected: t, transcript: insertAt(t, 2, filler) }),
  })),

  { name: 'reference:before', group: 'reference', make: (t, r) => ({ expected: t, transcript: `${spokenReference(r)}. ${engineStyle(t)}` }) },
  { name: 'reference:after', group: 'reference', make: (t, r) => ({ expected: t, transcript: `${engineStyle(t)} ${spokenReference(r)}.` }) },
  {
    name: 'reference:spoken-words',
    group: 'reference',
    make: (t, r) => ({
      expected: t,
      transcript: `${r.book.replace(/^([123]) /, (_, d: string) => `${BOOK_DIGITS[d]} `)} chapter ${r.chapter} verse ${r.verseStart}. ${engineStyle(t)}`,
    }),
  },
  {
    name: 'reference:verse-numbers-in-chunk',
    group: 'reference',
    make: (_t, r) => (r.verseTexts.length < 2
      ? null
      : {
          expected: r.verseTexts.map((v) => v.text).join(' '),
          transcript: r.verseTexts.map((v) => `${v.verse} ${plain(v.text)}`).join(' '),
        }),
  },

  {
    name: 'live:glued-word-boundary',
    group: 'live',
    make: (t) => {
      const w = words(t);
      if (w.length < 3) return null;
      const at = Math.floor(w.length / 2);
      return { expected: t, transcript: [...w.slice(0, at - 1), w[at - 1] + w[at], ...w.slice(at + 1)].join(' ') };
    },
  },
  {
    name: 'live:glued-after-punctuation',
    group: 'live',
    make: (t) => {
      const styled = engineStyle(t);
      const glued = styled.replace(/([,.?!]) (?=\S)/, '$1');
      return glued === styled ? null : { expected: t, transcript: glued };
    },
  },
];
