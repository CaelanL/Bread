import { diffArrays } from 'diff';
import { SPELLINGS } from './align-spellings';
import type { AlignmentWord } from './study-chunks';

interface Token {
  raw: string;
  normalized: string;
}

// 'quarter': a fraction said in quarters, equal to fourths only when the other side has digits.
type NumberKind = 'cardinal' | 'ordinal' | 'quarter';

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

const APOSTROPHES = '’‘\'ʼʹ′`´‛＇';
const HYPHENS = '\\-‐‑‒−﹣－';
// A run of punctuation between two letters that isn't only apostrophes and hyphens.
const WORD_JOINER = new RegExp(`(?<=\\p{L}\\p{M}*)([^\\p{L}\\p{M}\\p{N}\\s]*[^\\p{L}\\p{M}\\p{N}\\s${APOSTROPHES}${HYPHENS}][^\\p{L}\\p{M}\\p{N}\\s]*)(?=\\p{L})`, 'gu');
const DOUBLE_POSSESSIVE = new RegExp(`([^s]s)[${APOSTROPHES}]s(?=\\W*$)`);
const APOSTROPHE_OR_HYPHEN = new RegExp(`[${APOSTROPHES}${HYPHENS}]`, 'g');

/**
 * Tokenize a string into an array of tokens with raw and normalized forms.
 * - raw: original word with punctuation and casing
 * - normalized: see `normalize`
 *
 * Invisible characters (soft hyphen, zero-width joiners, BOM) are dropped; a zero-width space separates. Punctuation between two letters
 * splits them ("shepherd;I", "said,“Let", "him…and", "and/or"), unless it is only apostrophes or
 * hyphens, which `normalize` owns. Digits are left alone, so "3-1/4", "2,172" and "1:1" stay whole.
 */
function tokenize(text: string): Token[] {
  return normalizeThousandsSpacing(text.replace(/[\u00AD\u200C\u200D\u2060\uFEFF]/g, ''))
    .replace(/([—–…])/g, '$1 ') // em/en dash or ellipsis joins two words ("world—and") — split them
    .replace(WORD_JOINER, '$1 ')
    .split(/[\s\u200B]+/) // \s misses the zero-width space
    .filter(w => w.length > 0)
    .map(raw => ({ raw, normalized: normalize(raw) }))
    .filter(t => t.normalized.length > 0); // drop punctuation-only tokens (e.g. a bare "—")
}

function normalizeThousandsSpacing(text: string): string {
  return text.replace(/(\d)\s*,\s*(?=\d{3}(?:\D|$))/g, '$1,');
}

/**
 * Normalize a single word:
 * - lowercase, accents and ligatures folded ("Judæa" = "Judaea", "rosé" = "rose")
 * - "Moses's" said like "Moses'"
 * - drop apostrophes (curly, straight or look-alike) and hyphens: possessive vs
 *   plural ("eagle's"/"eagles") and hyphenation ("Beth-lehem"/
 *   "Bethlehem") are acoustically identical, so ASR output can't be
 *   penalized for the difference
 * - strip leading/trailing punctuation
 * - fold vocative "O" to "oh" (KJV has 1,000+ "O LORD"s; ASR hears "oh")
 */
function normalize(word: string): string {
  const n = word
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(DOUBLE_POSSESSIVE, '$1')
    .replace(APOSTROPHE_OR_HYPHEN, '')
    .replace(/^[^\w]+/, '')
    .replace(/[^\w]+$/, '');
  return n === 'o' ? 'oh' : n;
}

// How a word compares: spellings of one word fold to one key (lib/align-spellings.ts).
const spelling = (word: string) => SPELLINGS.get(word) ?? word;

// Hesitation sounds an ASR may transcribe. Dropped from the TRANSCRIPT
// side only, and deliberately excludes tokens that occur in scripture:
// "Ah" (Jer 1:6 etc.), "Er" (a name, Gen 38) and "err".
const FILLERS = new Set([
  'um', 'umm', 'ummm', 'uhm', 'uh', 'uhh', 'uhhh', 'hmm', 'hmmm', 'hm', 'mm', 'mmm', 'mhm',
  'erm', 'ehm', 'mmhmm', 'uhhuh',
]);

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

  // Colloquial hundreds with no scale word: "twelve hundred and sixty" = 1,260.
  if (!words.some((w) => SCALES[w])) {
    const h = words.indexOf('hundred');
    const lead = h > 0 ? parseUnderHundred(words.slice(0, h)) : null;
    if (lead !== null && lead > 10 && lead % 10 !== 0) {
      let rest = words.slice(h + 1);
      if (rest.length === 0) return lead * 100;
      if (rest[0] === 'and') rest = rest.slice(1);
      const remainder = parseUnderHundred(rest);
      return remainder !== null && remainder > 0 ? lead * 100 + remainder : null;
    }
  }

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
    const remainder = parseUnderThousand(tail); // "three thousand and two hundred" = 3,200
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

// Words that continue a number: a span right before one is cut short ("three hundred thousand
// and seven thousand" is 300,000 "and" 7,000, not 300,007 "thousand").
const CONTINUES = new Set(['hundred', 'thousand', 'million', 'billion', 'score']);

function trailingPunct(token: Token): boolean {
  return /[,;:.!?)\]]["'’”]*$/.test(token.raw);
}

const FRACTION_WORDS: Record<string, number> = {
  half: 2, halves: 2, third: 3, thirds: 3, fourth: 4, fourths: 4, quarter: 4, quarters: 4,
};

interface Fraction {
  numerator: number;
  denominator: number;
  consumed: number;
  quarter?: boolean;
}

function digitFraction(part: string): Omit<Fraction, 'consumed'> | null {
  const match = part.match(/^(\d)\/(\d)$/);
  if (!match || Number(match[1]) === 0 || Number(match[1]) >= Number(match[2])) return null;
  return { numerator: Number(match[1]), denominator: Number(match[2]) };
}

// "1/4", "one fourth", "a quarter", "three quarters", "a half". After a whole number and "and"
// (`afterAnd`) only: "a third", "a fourth", which elsewhere are ordinals ("a third time").
function parseFraction(tokens: Token[], start: number, afterAnd: boolean): Fraction | null {
  const parts = tokenNumberParts(tokens[start]);
  const digits = parts.length === 1 ? digitFraction(parts[0]) : null;
  if (digits) return { ...digits, consumed: 1 };
  if (parts.length !== 1 || !tokens[start + 1] || trailingPunct(tokens[start])) return null;
  const numerator = parts[0] === 'a' || parts[0] === 'an' ? 1 : SMALL_NUMBERS[parts[0]] ?? (/^\d$/.test(parts[0]) ? Number(parts[0]) : undefined);
  const next = tokenNumberParts(tokens[start + 1]);
  const denominator = next.length === 1 ? FRACTION_WORDS[next[0]] : undefined;
  if (!numerator || numerator > 9 || !denominator || numerator >= denominator) return null;
  if (!afterAnd && numerator === 1 && parts[0] !== 'one' && (denominator === 3 || next[0] === 'fourth')) return null;
  return { numerator, denominator, consumed: 2, quarter: next[0].startsWith('quarter') };
}

function fractionNumber(whole: number, fraction: Omit<Fraction, 'consumed'>, consumed: number): ParsedNumber {
  return { value: whole + fraction.numerator / fraction.denominator, kind: fraction.quarter ? 'quarter' : 'cardinal', consumed };
}

// A whole number may go on as a mixed number: "3-1/4", "3 1/4", "three and one fourth".
function withFraction(tokens: Token[], start: number, whole: ParsedNumber): ParsedNumber {
  if (whole.kind !== 'cardinal') return whole;
  const last = tokens[start + whole.consumed - 1];
  const and = tokens[start + whole.consumed];
  if (trailingPunct(last)) return whole;
  const next = and ? tokenNumberParts(and) : [];
  const digits = next.length === 1 ? digitFraction(next[0]) : null;
  if (digits && /^\d/.test(last.raw)) return fractionNumber(whole.value, digits, whole.consumed + 1);
  if (next.length !== 1 || next[0] !== 'and' || trailingPunct(and) || !tokens[start + whole.consumed + 1]) return whole;
  const fraction = parseFraction(tokens, start + whole.consumed + 1, true);
  return fraction ? fractionNumber(whole.value, fraction, whole.consumed + 1 + fraction.consumed) : whole;
}

function parseLongestNumber(tokens: Token[], start: number): ParsedNumber | null {
  const fraction = parseFraction(tokens, start, false);
  if (fraction) return fractionNumber(0, fraction, fraction.consumed);
  const whole = parseWholeNumber(tokens, start);
  return whole && withFraction(tokens, start, whole);
}

function parseWholeNumber(tokens: Token[], start: number): ParsedNumber | null {
  const firstParts = tokenNumberParts(tokens[start]);
  const mixed = firstParts.length === 2 ? digitFraction(firstParts[1]) : null; // "3-1/4"
  const mixedWhole = mixed ? parseDigitNumber(firstParts[0]) : null;
  if (mixed && mixedWhole?.kind === 'cardinal') return fractionNumber(mixedWhole.value, mixed, 1);
  if (firstParts.length === 1) {
    const digit = parseDigitNumber(firstParts[0]);
    // A digit and a larger scale word ("600 thousand", "2 hundred", "12 hundred") is one number.
    if (digit && digit.kind === 'cardinal' && !trailingPunct(tokens[start]) && tokens[start + 1]) {
      const next = tokenNumberParts(tokens[start + 1]);
      if (next.length === 1 && SCALES[next[0]] && SCALES[next[0]] > digit.value) {
        return { value: digit.value * SCALES[next[0]], kind: 'cardinal', consumed: 2 };
      }
      if (next.length === 1 && next[0] === 'hundred' && digit.value < 100 && (digit.value < 10 || digit.value % 10 !== 0)) {
        return { value: digit.value * 100, kind: 'cardinal', consumed: 2 };
      }
    }
    if (digit) return { ...digit, consumed: 1 };
  }

  const candidates: ParsedNumber[] = [];
  const words: string[] = [];
  const maxEnd = Math.min(tokens.length, start + MAX_NUMBER_TOKENS);

  for (let end = start; end < maxEnd; end++) {
    let parts = tokenNumberParts(tokens[end]);
    // "an hundred", "a thousand" read as "one", at the start or after "and" or a scale word. The
    // engine writes "and hundred" for "an hundred", so a number may start with that "and" too.
    const article = parts[0] === 'a' || parts[0] === 'an' || (end === start && parts[0] === 'and');
    if ((end === start || words.at(-1) === 'and' || SCALES[words.at(-1) ?? '']) && parts.length === 1 && article && tokens[end + 1] && !trailingPunct(tokens[end])) {
      const next = tokenNumberParts(tokens[end + 1]);
      if (next.length >= 1 && (next[0] === 'hundred' || SCALES[next[0]])) parts = ['one'];
    }
    if (parts.length === 0 || parts.some((part) => !NUMBER_WORDS.has(part))) break;
    words.push(...parts);
    const parsed = parseWordNumber(words);
    if (parsed) candidates.push({ ...parsed, consumed: end - start + 1 });
    if (trailingPunct(tokens[end])) break; // a number ends at punctuation ("twenty, six" is two numbers)
  }

  // The longest span not cut short right before a word that continues it.
  for (let k = candidates.length - 1; k >= 0; k--) {
    const after = tokens[start + candidates[k].consumed];
    const afterParts = after ? tokenNumberParts(after) : [];
    if (!(afterParts.length && CONTINUES.has(afterParts[0]))) return candidates[k];
  }
  return candidates.at(-1) ?? null;
}

// "hundredfold", "100-fold" and "an hundred fold" share one key.
const FOLD_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, thirty: 30, sixty: 60, hundred: 100, thousand: 1000 };

function foldValue(tokens: Token[], i: number): { value: number; consumed: number } | null {
  if ((tokens[i].normalized === 'a' || tokens[i].normalized === 'an') && tokens[i + 1]) {
    const inner = foldValue(tokens, i + 1);
    if (inner && inner.value >= 100) return { value: inner.value, consumed: inner.consumed + 1 };
  }
  const match = tokens[i].normalized.match(/^(\w+?)fold$/); // hyphens already dropped: "100-fold" -> "100fold"
  const value = match ? (/^\d+$/.test(match[1]) ? Number(match[1]) : FOLD_WORDS[match[1]]) : undefined;
  return value ? { value, consumed: 1 } : null;
}

function toComparisonUnits(tokens: Token[]): ComparisonUnit[] {
  const units: ComparisonUnit[] = [];
  for (let i = 0; i < tokens.length;) {
    const fold = foldValue(tokens, i);
    if (fold) {
      units.push({ key: `fold:${fold.value}`, tokens: tokens.slice(i, i + fold.consumed) });
      i += fold.consumed;
      continue;
    }
    const number = parseLongestNumber(tokens, i);
    if (number) {
      units.push({
        key: `number:${number.kind}:${number.value}`,
        tokens: tokens.slice(i, i + number.consumed),
      });
      i += number.consumed;
    } else {
      units.push({ key: spelling(tokens[i].normalized), tokens: [tokens[i]] });
      i++;
    }
  }
  return units;
}

const unitValue = (unit: ComparisonUnit | undefined, kind = 'cardinal') =>
  unit?.key.startsWith(`number:${kind}:`) ? Number(unit.key.slice(`number:${kind}:`.length)) : undefined;

// Spans that read as one number only when the other side says that number: "100 fold" or "seven
// fold" when the other side has the -fold word ("one fold" stays a sheepfold), and the KJV's
// "five and twenty" (25) or "seven and twentieth" when the other side has 25 or 27th. Elsewhere
// they stay separate, so "four and twenty, six" still matches "4 and 20, 6".
function mergeContextNumbers(units: ComparisonUnit[], other: ComparisonUnit[]): ComparisonUnit[] {
  const keys = new Set(other.map((unit) => unit.key));
  // Numbers the other side writes in digits: a different wording said aloud ("twenty five" for
  // "five and twenty", "a quarter" for "one fourth") is a different reading, not a spelling.
  const digitKeys = new Set(other.filter((unit) => unit.tokens.some((t) => /\d/.test(t.raw))).map((unit) => unit.key));
  const out: ComparisonUnit[] = [];
  for (let i = 0; i < units.length; i++) {
    const quarter = units[i].key.startsWith('number:quarter:') && `number:cardinal:${units[i].key.slice('number:quarter:'.length)}`;
    if (quarter && digitKeys.has(quarter)) {
      out.push({ key: quarter, tokens: units[i].tokens });
      continue;
    }
    const value = unitValue(units[i]) ?? FOLD_WORDS[units[i].key];
    const fold = `fold:${value}`;
    if (value && units[i + 1]?.key === 'fold' && keys.has(fold)) {
      out.push({ key: fold, tokens: [...units[i].tokens, ...units[i + 1].tokens] });
      i++;
      continue;
    }
    const unit = unitValue(units[i]);
    const tensUnit = units[i + 2];
    const kind = unitValue(tensUnit) !== undefined ? 'cardinal' : 'ordinal';
    const tens = unitValue(tensUnit, kind);
    const key = `number:${kind}:${(unit ?? 0) + (tens ?? 0)}`;
    if (unit && unit <= 9 && units[i].tokens.length === 1 && units[i + 1]?.key === 'and' && tens && tens >= 20 && tens % 10 === 0 && tens < 100 && digitKeys.has(key) && !crossesPunct(units.slice(i, i + 2))) {
      out.push({ key, tokens: [...units[i].tokens, ...units[i + 1].tokens, ...tensUnit.tokens] });
      i += 2;
      continue;
    }
    const chain = numberChain(units, i, keys, digitKeys);
    if (chain) {
      out.push(chain.unit);
      i = chain.end - 1;
      continue;
    }
    out.push(units[i]);
  }
  return out;
}

// The KJV's added-up numbers, "an hundred and thirty and seven" (137) or "an hundred twenty and
// three" (123), against digits on one side: numbers in a row, "and" between some, each under the last place
// of the one before ("twenty ten" is not 30), none across punctuation ("seventy, two" is not 72).
// Read as their sum only when the other side has it, longest first.
const MAX_CHAIN = 4;

// Punctuation after any of these units ("five; and twenty", 'thirty," and seven').
const crossesPunct = (between: ComparisonUnit[]) => between.some((unit) => trailingPunct(unit.tokens[unit.tokens.length - 1]));

const lastPlace = (n: number) => {
  let place = 1;
  while (n % (place * 10) === 0) place *= 10;
  return place;
};

function numberChain(units: ComparisonUnit[], start: number, keys: Set<string>, digitKeys: Set<string>): { unit: ComparisonUnit; end: number } | undefined {
  const totals: number[] = [];
  const ends: number[] = [];
  let sum = 0;
  let last = 0;
  let j = start;
  while (totals.length < MAX_CHAIN) {
    const at = totals.length && units[j]?.key === 'and' ? j + 1 : j;
    const value = unitValue(units[at]);
    if (!value || (totals.length && crossesPunct(units.slice(j - 1, at)))) break;
    // The KJV's scale word covers the sum before it: "an hundred and forty and four thousand" is
    // 144,000, "fifty and nine thousand and three hundred" 59,300.
    const scale = totals.length ? [1_000_000, 1000].find((s) => value >= s && Math.floor(value / s) < lastPlace(last) && sum < s) : undefined;
    if (totals.length && value >= lastPlace(last) && !scale) break;
    j = at + 1;
    ends.push(j);
    sum = scale ? (sum + Math.floor(value / scale)) * scale + (value % scale) : sum + value;
    last = scale ? sum : value;
    totals.push(sum);
  }
  for (let n = totals.length; n >= 2; n--) {
    const key = `number:cardinal:${totals[n - 1]}`;
    const tokens = unitTokens(units.slice(start, ends[n - 1]));
    // Digits on either side: "300,000 and 7" is how an engine writes "three hundred thousand and seven".
    if (digitKeys.has(key) || (keys.has(key) && tokens.some((t) => /\d/.test(t.raw)))) return { unit: { key, tokens }, end: ends[n - 1] };
  }
  return undefined;
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
  const expectedWords = toComparisonUnits(expectedTokens);
  const transcribedWords = toComparisonUnits(transcribedTokens);
  const expectedMerged = mergeContextNumbers(expectedWords, transcribedWords);
  const transcribedMerged = mergeContextNumbers(transcribedWords, expectedWords);
  // A run of words whose letters spell one word said on either side ("for as much" /
  // "forasmuch") becomes one unit before the diff, so a shared short word ("as", "for")
  // can't anchor the diff inside the compound and split it into missing and added.
  const said = new Set([...expectedMerged, ...transcribedMerged].filter(isWordUnit).map(compoundKey));
  const expectedUnits = joinCompounds(expectedMerged, said);
  const transcribedUnits = joinCompounds(transcribedMerged, said);

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

const MAX_COMPOUND_PARTS = 4;

// Said as two words: "withal" is "with all", "altogether" is "all together".
const COMPOUND_SAID: Record<string, string> = { withal: 'withall', altogether: 'alltogether' };
const compoundKey = (unit: ComparisonUnit) => COMPOUND_SAID[unit.key] ?? unit.key;

function isWordUnit(unit: ComparisonUnit): boolean {
  return unit.tokens.length === 1 && isAlphabetic(unit.tokens[0]);
}

function joinCompounds(units: ComparisonUnit[], said: Set<string>): ComparisonUnit[] {
  const out: ComparisonUnit[] = [];
  for (let i = 0; i < units.length;) {
    let end = i;
    let key = compoundKey(units[i]);
    for (let j = i + 1; j < Math.min(units.length, i + MAX_COMPOUND_PARTS) && isWordUnit(units[i]) && isWordUnit(units[j]); j++) {
      key += compoundKey(units[j]);
      if (said.has(key)) end = j;
    }
    const parts = units.slice(i, end + 1);
    out.push({ key: parts.map(compoundKey).join(''), tokens: parts.flatMap((unit) => unit.tokens) });
    i = end + 1;
  }
  return out;
}

function isAlphabetic(token: Token): boolean {
  return /^[a-z]+$/.test(token.normalized);
}

const pushToken = (alignment: AlignmentWord[], token: Token, status: 'correct' | 'missing' | 'added') =>
  alignment.push(
    status === 'added'
      ? { word: token.raw.toLowerCase(), status }
      : status === 'missing'
        ? { word: token.raw, status, expected: token.raw }
        : { word: token.raw, status },
  );

/**
 * Resolve a substitution region (expected tokens the diff removed vs
 * transcribed tokens it added). First re-diff it word by word: a number span
 * or compound the unit diff treated as one block may still share plain words
 * with the transcript. What's left goes to `greedySubstitution`.
 */
function alignSubstitution(
  removed: Token[],
  added: Token[],
  alignment: AlignmentWord[]
): void {
  const wordKey = (t: Token) => spelling(t.normalized);
  const parts = diffArrays(removed.map(wordKey), added.map(wordKey));
  if (!parts.some((part) => !part.added && !part.removed)) {
    greedySubstitution(removed, added, alignment);
    return;
  }
  let a = 0;
  let b = 0;
  for (let p = 0; p < parts.length; p++) {
    const n = parts[p].value.length;
    if (parts[p].removed && parts[p + 1]?.added) {
      const m = parts[p + 1].value.length;
      greedySubstitution(removed.slice(a, a + n), added.slice(b, b + m), alignment);
      a += n;
      b += m;
      p++;
    } else if (parts[p].removed) {
      for (const t of removed.slice(a, a + n)) pushToken(alignment, t, 'missing');
      a += n;
    } else if (parts[p].added) {
      for (const t of added.slice(b, b + n)) pushToken(alignment, t, 'added');
      b += n;
    } else {
      for (const t of removed.slice(a, a + n)) pushToken(alignment, t, 'correct');
      a += n;
      b += n;
    }
  }
}

/**
 * Alphabetic words that only differ in how they're split ("for ever" ↔
 * "forever") are spoken identically, so match runs whose letters, as
 * written, concatenate equal. A transcript word that matches nothing is
 * skipped as added rather than stalling the walk, so one slip costs only
 * itself. Digits are excluded: numeric equivalence is handled before the
 * diff, and `72` must not match `7 2` through string concatenation.
 */
function greedySubstitution(
  removed: Token[],
  added: Token[],
  alignment: AlignmentWord[]
): void {
  const tryMatch = (a: number, b: number): [number, number] | null => {
    if (!isAlphabetic(removed[a]) || !isAlphabetic(added[b])) return null;
    let i = a;
    let j = b;
    let exp = removed[i].normalized;
    let got = added[j].normalized;
    while (exp !== got) {
      if (got.startsWith(exp) && i + 1 < removed.length && isAlphabetic(removed[i + 1])) exp += removed[++i].normalized;
      else if (exp.startsWith(got) && j + 1 < added.length && isAlphabetic(added[j + 1])) got += added[++j].normalized;
      else return null;
    }
    return [i, j];
  };
  let a = 0;
  let b = 0;
  while (a < removed.length) {
    let hit: [number, number] | null = null;
    let at = b;
    for (; at < added.length && !hit; at++) hit = tryMatch(a, at);
    if (hit) {
      for (let k = b; k < at - 1; k++) pushToken(alignment, added[k], 'added');
      for (let k = a; k <= hit[0]; k++) pushToken(alignment, removed[k], 'correct');
      a = hit[0] + 1;
      b = hit[1] + 1;
    } else {
      pushToken(alignment, removed[a], 'missing');
      a++;
    }
  }
  for (; b < added.length; b++) pushToken(alignment, added[b], 'added');
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
