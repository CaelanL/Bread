import { diffArrays } from 'diff';
import type { AlignmentWord } from './study-chunks';

interface Token {
  raw: string;
  normalized: string;
}

type NumberKind = 'cardinal' | 'ordinal';

interface ParsedNumber {
  value: number;
  kind: NumberKind;
  consumed: number;
}

interface ComparisonUnit {
  key: string;
  tokens: Token[];
}

const SMALL_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALES: Record<string, number> = {
  thousand: 1_000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

const ORDINAL_TO_CARDINAL: Record<string, string> = {
  zeroth: 'zero',
  first: 'one',
  second: 'two',
  third: 'three',
  fourth: 'four',
  fifth: 'five',
  sixth: 'six',
  seventh: 'seven',
  eighth: 'eight',
  ninth: 'nine',
  tenth: 'ten',
  eleventh: 'eleven',
  twelfth: 'twelve',
  thirteenth: 'thirteen',
  fourteenth: 'fourteen',
  fifteenth: 'fifteen',
  sixteenth: 'sixteen',
  seventeenth: 'seventeen',
  eighteenth: 'eighteen',
  nineteenth: 'nineteen',
  twentieth: 'twenty',
  thirtieth: 'thirty',
  fortieth: 'forty',
  fiftieth: 'fifty',
  sixtieth: 'sixty',
  seventieth: 'seventy',
  eightieth: 'eighty',
  ninetieth: 'ninety',
  hundredth: 'hundred',
  thousandth: 'thousand',
  millionth: 'million',
  billionth: 'billion',
};

const NUMBER_WORDS = new Set([
  ...Object.keys(SMALL_NUMBERS),
  ...Object.keys(TENS),
  ...Object.keys(SCALES),
  ...Object.keys(ORDINAL_TO_CARDINAL),
  'hundred',
  'and',
]);

// Four three-digit groups plus billion/million/thousand use at most 23 words
// when each group includes the optional "and".
const MAX_NUMBER_TOKENS = 23;

/**
 * Tokenize a string into an array of tokens with raw and normalized forms.
 * - raw: original word with punctuation and casing
 * - normalized: lowercase, leading/trailing punctuation stripped, internal apostrophes/hyphens kept
 */
function tokenize(text: string): Token[] {
  return normalizeThousandsSpacing(text)
    .replace(/([—–])/g, '$1 ') // em/en dash joins two words ("world—and") — split them
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(raw => ({ raw, normalized: normalize(raw) }))
    .filter(t => t.normalized.length > 0); // drop punctuation-only tokens (e.g. a bare "—")
}

function normalizeThousandsSpacing(text: string): string {
  return text.replace(/(\d)\s*,\s*(?=\d{3}(?:\D|$))/g, '$1,');
}

/**
 * Normalize a single word:
 * - lowercase
 * - drop apostrophes (curly or straight) and hyphens: possessive vs
 *   plural ("eagle's"/"eagles") and hyphenation ("Beth-lehem"/
 *   "Bethlehem") are acoustically identical, so ASR output can't be
 *   penalized for the difference
 * - strip leading/trailing punctuation
 * - fold vocative "O" to "oh" (KJV has 1,000+ "O LORD"s; ASR hears "oh")
 */
function normalize(word: string): string {
  const n = word
    .toLowerCase()
    .replace(/[’‘'-]/g, '')
    .replace(/^[^\w]+/, '')
    .replace(/[^\w]+$/, '');
  return n === 'o' ? 'oh' : n;
}

// Hesitation sounds an ASR may transcribe. Dropped from the TRANSCRIPT
// side only, and deliberately excludes tokens that occur in scripture:
// "Ah" (Jer 1:6 etc.) and "Er" (a name, Gen 38).
const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'hmm', 'hm', 'mm', 'mmm', 'mhm']);

function tokenNumberParts(token: Token): string[] {
  const cleaned = token.raw
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9]+$/, '');
  return cleaned ? cleaned.split(/[-‐‑‒–—]/).filter(Boolean) : [];
}

function parseDigitNumber(part: string): Omit<ParsedNumber, 'consumed'> | null {
  const match = part.match(/^(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th)?$/);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isSafeInteger(value)) return null;

  const suffix = match[2];
  if (!suffix) return { value, kind: 'cardinal' };
  if (suffix !== ordinalSuffix(value)) return null;
  return { value, kind: 'ordinal' };
}

function ordinalSuffix(value: number): 'st' | 'nd' | 'rd' | 'th' {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  if (value % 10 === 1) return 'st';
  if (value % 10 === 2) return 'nd';
  if (value % 10 === 3) return 'rd';
  return 'th';
}

function parseUnderHundred(words: string[]): number | null {
  if (words.length === 1) {
    return SMALL_NUMBERS[words[0]] ?? TENS[words[0]] ?? null;
  }
  if (words.length === 2) {
    const tens = TENS[words[0]];
    const unit = SMALL_NUMBERS[words[1]];
    if (tens !== undefined && unit !== undefined && unit >= 1 && unit <= 9) {
      return tens + unit;
    }
  }
  return null;
}

function parseUnderThousand(words: string[]): number | null {
  if (words.length === 0 || words.includes('zero')) return null;

  if (words.length >= 2 && SMALL_NUMBERS[words[0]] >= 1 && SMALL_NUMBERS[words[0]] <= 9 && words[1] === 'hundred') {
    const hundreds = SMALL_NUMBERS[words[0]] * 100;
    let rest = words.slice(2);
    if (rest.length === 0) return hundreds;
    if (rest[0] === 'and') rest = rest.slice(1);
    if (rest.length === 0) return null;
    const remainder = parseUnderHundred(rest);
    return remainder !== null && remainder > 0 ? hundreds + remainder : null;
  }

  if (words.includes('hundred') || words.includes('and')) return null;
  return parseUnderHundred(words);
}

function parseCardinalWords(words: string[]): number | null {
  if (words.length === 1 && words[0] === 'zero') return 0;
  if (words.length === 0 || words.includes('zero')) return null;

  let total = 0;
  let groupStart = 0;
  let previousScale = Number.POSITIVE_INFINITY;
  let sawScale = false;

  for (let i = 0; i < words.length; i++) {
    const scale = SCALES[words[i]];
    if (scale === undefined) continue;
    if (scale >= previousScale) return null;

    const group = parseUnderThousand(words.slice(groupStart, i));
    if (group === null || group <= 0) return null;
    total += group * scale;
    previousScale = scale;
    groupStart = i + 1;
    sawScale = true;
  }

  let tail = words.slice(groupStart);
  if (tail.length === 0) return sawScale ? total : null;

  if (tail[0] === 'and') {
    if (!sawScale) return null;
    tail = tail.slice(1);
    const remainder = parseUnderHundred(tail);
    return remainder !== null && remainder > 0 ? total + remainder : null;
  }

  const remainder = parseUnderThousand(tail);
  return remainder !== null ? total + remainder : null;
}

function parseWordNumber(words: string[]): Omit<ParsedNumber, 'consumed'> | null {
  const ordinal = words.at(-1) ?? '';
  const ordinalCardinal = ORDINAL_TO_CARDINAL[ordinal];
  if (ordinalCardinal) {
    if (words.length === 1) {
      const value = ordinal === 'hundredth' ? 100 : SCALES[ordinalCardinal];
      if (value) return { value, kind: 'ordinal' };
    }
    const cardinalWords = [...words.slice(0, -1), ordinalCardinal];
    const value = parseCardinalWords(cardinalWords);
    return value === null ? null : { value, kind: 'ordinal' };
  }

  const value = parseCardinalWords(words);
  return value === null ? null : { value, kind: 'cardinal' };
}

function parseLongestNumber(tokens: Token[], start: number): ParsedNumber | null {
  const firstParts = tokenNumberParts(tokens[start]);
  if (firstParts.length === 1) {
    const digit = parseDigitNumber(firstParts[0]);
    if (digit) return { ...digit, consumed: 1 };
  }

  let best: ParsedNumber | null = null;
  const words: string[] = [];
  const maxEnd = Math.min(tokens.length, start + MAX_NUMBER_TOKENS);

  for (let end = start; end < maxEnd; end++) {
    const parts = tokenNumberParts(tokens[end]);
    if (parts.length === 0 || parts.some((part) => !NUMBER_WORDS.has(part))) break;
    words.push(...parts);
    const parsed = parseWordNumber(words);
    if (parsed) best = { ...parsed, consumed: end - start + 1 };
  }

  return best;
}

function toComparisonUnits(tokens: Token[]): ComparisonUnit[] {
  const units: ComparisonUnit[] = [];
  for (let i = 0; i < tokens.length;) {
    const number = parseLongestNumber(tokens, i);
    if (number) {
      units.push({
        key: `number:${number.kind}:${number.value}`,
        tokens: tokens.slice(i, i + number.consumed),
      });
      i += number.consumed;
    } else {
      units.push({ key: tokens[i].normalized, tokens: [tokens[i]] });
      i++;
    }
  }
  return units;
}

function unitTokens(units: ComparisonUnit[]): Token[] {
  return units.flatMap((unit) => unit.tokens);
}

function pushMissing(units: ComparisonUnit[], alignment: AlignmentWord[]): void {
  for (const token of unitTokens(units)) {
    alignment.push({ word: token.raw, status: 'missing', expected: token.raw });
  }
}

function pushAdded(units: ComparisonUnit[], alignment: AlignmentWord[]): void {
  for (const token of unitTokens(units)) {
    alignment.push({ word: token.raw.toLowerCase(), status: 'added' });
  }
}

/**
 * Align a cleaned transcription against an expected verse.
 * Returns an array of AlignmentWord objects for rendering.
 *
 * @param expectedVerse - The original verse text (with punctuation/caps)
 * @param cleanedTranscription - The LLM-cleaned transcription
 * @returns Array of alignment words with status: correct, missing, added
 */
export function alignTranscription(
  expectedVerse: string,
  cleanedTranscription: string
): AlignmentWord[] {
  const expectedTokens = tokenize(expectedVerse);
  const transcribedTokens = tokenize(cleanedTranscription).filter(
    t => !FILLERS.has(t.normalized)
  );
  const expectedUnits = toComparisonUnits(expectedTokens);
  const transcribedUnits = toComparisonUnits(transcribedTokens);

  // Numeric spans become one comparison unit before the diff, so formatting
  // differences ("seventy-two" vs "72") match without hiding real value
  // differences. Every unit still retains its raw source tokens for rendering.
  const diffResult = diffArrays(
    expectedUnits.map(unit => unit.key),
    transcribedUnits.map(unit => unit.key)
  );

  const alignment: AlignmentWord[] = [];
  let expectedUnitIdx = 0;
  let transcribedUnitIdx = 0;

  for (let p = 0; p < diffResult.length; p++) {
    const part = diffResult[p];
    const wordCount = part.value.length;

    if (part.removed) {
      // A removed run followed by an added run is a substitution region.
      // Check it for split/joined compounds ("for ever" ↔ "forever",
      // "forty-two" ↔ "forty two") before flagging words wrong.
      const next = diffResult[p + 1];
      if (next?.added) {
        const removed = expectedUnits.slice(expectedUnitIdx, expectedUnitIdx + wordCount);
        const added = transcribedUnits.slice(transcribedUnitIdx, transcribedUnitIdx + next.value.length);
        alignSubstitution(unitTokens(removed), unitTokens(added), alignment);
        expectedUnitIdx += removed.length;
        transcribedUnitIdx += added.length;
        p++; // consumed the added part too
        continue;
      }
      const removed = expectedUnits.slice(expectedUnitIdx, expectedUnitIdx + wordCount);
      pushMissing(removed, alignment);
      expectedUnitIdx += removed.length;
    } else if (part.added) {
      const added = transcribedUnits.slice(transcribedUnitIdx, transcribedUnitIdx + wordCount);
      pushAdded(added, alignment);
      transcribedUnitIdx += added.length;
    } else {
      // Equal units match. Expand the expected side so result rendering keeps
      // the exact wording and punctuation of the saved translation.
      for (let i = 0; i < wordCount; i++) {
        const unit = expectedUnits[expectedUnitIdx++];
        if (unit) {
          for (const token of unit.tokens) {
            alignment.push({ word: token.raw, status: 'correct' });
          }
        }
        if (transcribedUnitIdx < transcribedUnits.length) {
          transcribedUnitIdx++;
        }
      }
    }
  }

  if (expectedUnitIdx < expectedUnits.length) {
    pushMissing(expectedUnits.slice(expectedUnitIdx), alignment);
  }
  if (transcribedUnitIdx < transcribedUnits.length) {
    pushAdded(transcribedUnits.slice(transcribedUnitIdx), alignment);
  }

  return alignment;
}

function isAlphabetic(token: Token): boolean {
  return /^[a-z]+$/.test(token.normalized);
}

/**
 * Resolve a substitution region (expected tokens the diff removed vs
 * transcribed tokens it added). Alphabetic words that only differ in how
 * they're split ("for ever" ↔ "forever") are spoken identically, so greedily
 * match runs whose normalized concatenations are equal. Digits are excluded:
 * numeric equivalence is handled before the diff, and `72` must not match
 * `7 2` through generic string concatenation.
 */
function alignSubstitution(
  removed: Token[],
  added: Token[],
  alignment: AlignmentWord[]
): void {
  let a = 0;
  let b = 0;
  while (a < removed.length && b < added.length) {
    if (!isAlphabetic(removed[a]) || !isAlphabetic(added[b])) {
      alignment.push({ word: removed[a].raw, status: 'missing', expected: removed[a].raw });
      a++;
      continue;
    }

    let i = a, j = b;
    let exp = removed[i].normalized;
    let got = added[j].normalized;
    while (exp !== got) {
      if (got.startsWith(exp) && i + 1 < removed.length && isAlphabetic(removed[i + 1])) {
        exp += removed[++i].normalized;
      } else if (exp.startsWith(got) && j + 1 < added.length && isAlphabetic(added[j + 1])) {
        got += added[++j].normalized;
      } else {
        break;
      }
    }
    if (exp === got) {
      for (let k = a; k <= i; k++) {
        alignment.push({ word: removed[k].raw, status: 'correct' });
      }
      a = i + 1;
      b = j + 1;
    } else {
      alignment.push({ word: removed[a].raw, status: 'missing', expected: removed[a].raw });
      a++;
    }
  }
  while (a < removed.length) {
    alignment.push({ word: removed[a].raw, status: 'missing', expected: removed[a].raw });
    a++;
  }
  while (b < added.length) {
    alignment.push({ word: added[b].raw.toLowerCase(), status: 'added' });
    b++;
  }
}

/**
 * Build an alignment where every word of the expected verse is missing,
 * as if the user said nothing. Used for "peeked" chunks: revealing the
 * answer before reciting zeroes that chunk's contribution to the score.
 *
 * Reuses the same tokenizer as alignTranscription (via the empty-string
 * transcription path) so the word count stays consistent with normal
 * scoring.
 */
export function buildAllMissingAlignment(expectedVerse: string): AlignmentWord[] {
  return alignTranscription(expectedVerse, '');
}
