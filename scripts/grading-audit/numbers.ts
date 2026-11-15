// Rewrites spoken number words as the digits a speech engine might print. Deliberately
// independent of lib/align.ts: if both shared one grammar, a gap in it would hide itself.
//
// Each converted span records which forms it needed, so a pass can convert only the
// spans that use one form and its failures stay attributable:
//   standard  "seventy-two", "one hundred and twenty", "six thousand and seven hundred"
//   article   "an hundred", "a thousand"
//   archaic   "threescore and ten", "two and twenty", "seven and twentieth"

export type NumberForm = 'standard' | 'article' | 'archaic';

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCORES: Record<string, number> = { threescore: 60, fourscore: 80, sixscore: 120 };
const SCALES: Record<string, number> = { thousand: 1_000, million: 1_000_000 };
const ORDINALS: Record<string, string> = {
  first: 'one', second: 'two', third: 'three', fourth: 'four', fifth: 'five', sixth: 'six',
  seventh: 'seven', eighth: 'eight', ninth: 'nine', tenth: 'ten', eleventh: 'eleven',
  twelfth: 'twelve', thirteenth: 'thirteen', fourteenth: 'fourteen', fifteenth: 'fifteen',
  sixteenth: 'sixteen', seventeenth: 'seventeen', eighteenth: 'eighteen',
  nineteenth: 'nineteen', twentieth: 'twenty', thirtieth: 'thirty', fortieth: 'forty',
  fiftieth: 'fifty', sixtieth: 'sixty', seventieth: 'seventy', eightieth: 'eighty',
  ninetieth: 'ninety', hundredth: 'hundred', thousandth: 'thousand',
};

interface Atom {
  word: string; // cardinal form, lowercase
  ordinal: boolean;
  last: boolean; // trailing punctuation or end of a hyphenated word's parts: the span may not continue
}

interface Parsed {
  value: number;
  end: number; // exclusive atom index
  forms: Set<NumberForm>;
}

function atomsOf(rawWords: string[]): { atoms: Atom[]; wordOfAtom: number[] } {
  const atoms: Atom[] = [];
  const wordOfAtom: number[] = [];
  rawWords.forEach((raw, w) => {
    const core = raw.toLowerCase().replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
    const trailing = /[^A-Za-z]$/.test(raw);
    const parts = core.split('-').filter(Boolean);
    if (parts.length === 0) parts.push('');
    parts.forEach((part, p) => {
      const ordinal = part in ORDINALS;
      atoms.push({
        word: ordinal ? ORDINALS[part] : part,
        ordinal,
        last: ordinal || (p === parts.length - 1 && trailing),
      });
      wordOfAtom.push(w);
    });
  });
  return { atoms, wordOfAtom };
}

class Parser {
  constructor(private atoms: Atom[]) {}

  private at(i: number): Atom | undefined {
    return this.atoms[i];
  }

  private canContinue(i: number): boolean {
    return i > 0 && !this.atoms[i - 1].last;
  }

  // 1..99, including archaic "two and twenty", "threescore and ten", "four score".
  sub100(i: number, forms: Set<NumberForm>): Parsed | null {
    const a = this.at(i);
    if (!a) return null;
    const w = a.word;
    if (w in TEENS) return { value: TEENS[w], end: i + 1, forms };
    if (w in TENS) {
      const next = this.at(i + 1);
      if (next && this.canContinue(i + 1) && next.word in UNITS) {
        return { value: TENS[w] + UNITS[next.word], end: i + 2, forms };
      }
      return { value: TENS[w], end: i + 1, forms };
    }
    if (w in SCORES) return this.scoreTail(SCORES[w], i + 1, new Set([...forms, 'archaic']));
    if (w in UNITS) {
      const and = this.at(i + 1);
      const tens = this.at(i + 2);
      if (!a.ordinal && and?.word === 'and' && this.canContinue(i + 1) && tens && this.canContinue(i + 2) && tens.word in TENS) {
        return { value: UNITS[w] + TENS[tens.word], end: i + 3, forms: new Set([...forms, 'archaic']) };
      }
      const score = this.at(i + 1);
      if (!a.ordinal && score?.word === 'score' && this.canContinue(i + 1)) {
        return this.scoreTail(UNITS[w] * 20, i + 2, new Set([...forms, 'archaic']));
      }
      return { value: UNITS[w], end: i + 1, forms };
    }
    return null;
  }

  private scoreTail(base: number, i: number, forms: Set<NumberForm>): Parsed {
    const and = this.at(i);
    const rest = this.at(i + 1);
    if (and?.word === 'and' && this.canContinue(i) && rest && this.canContinue(i + 1) && (rest.word in UNITS || rest.word in TEENS)) {
      return { value: base + (UNITS[rest.word] ?? TEENS[rest.word]), end: i + 2, forms };
    }
    return { value: base, end: i, forms };
  }

  // 1..999
  group(i: number, forms: Set<NumberForm>): Parsed | null {
    const a = this.at(i);
    const h = this.at(i + 1);
    if (a && h?.word === 'hundred' && this.canContinue(i + 1)) {
      let lead = 0;
      let f = forms;
      if (a.word in UNITS && !a.ordinal) lead = UNITS[a.word];
      else if ((a.word === 'a' || a.word === 'an') && !a.ordinal) {
        lead = 1;
        f = new Set([...forms, 'article']);
      }
      if (lead) {
        const base = lead * 100;
        const j = i + 2;
        if (h.last) return { value: base, end: j, forms: f };
        if (this.at(j)?.word === 'and' && this.canContinue(j)) {
          const tail = this.sub100(j + 1, f);
          if (tail && this.canContinue(j + 1)) return { value: base + tail.value, end: tail.end, forms: tail.forms };
          return { value: base, end: j, forms: f };
        }
        const tail = this.sub100(j, f);
        if (tail) return { value: base + tail.value, end: tail.end, forms: tail.forms };
        return { value: base, end: j, forms: f };
      }
    }
    return this.sub100(i, forms);
  }

  // Full number from atom i, or null.
  number(i: number): Parsed | null {
    let forms = new Set<NumberForm>(['standard']);
    let total = 0;
    let current: Parsed | null;
    const a = this.at(i);
    const s = this.at(i + 1);
    if (a && !a.ordinal && (a.word === 'a' || a.word === 'an') && s && s.word in SCALES && this.canContinue(i + 1)) {
      current = { value: 1, end: i + 1, forms: new Set([...forms, 'article']) };
    } else {
      current = this.group(i, forms);
    }
    if (!current) return null;
    let previousScale = Infinity;
    for (;;) {
      forms = current.forms;
      const scaleAtom = this.at(current.end);
      if (!scaleAtom || !this.canContinue(current.end) || !(scaleAtom.word in SCALES)) break;
      const scale = SCALES[scaleAtom.word];
      if (scale >= previousScale) break;
      previousScale = scale;
      total += current.value * scale;
      const j: number = current.end + 1;
      current = { value: 0, end: j, forms };
      if (scaleAtom.last) break;
      if (this.at(j)?.word === 'and' && this.canContinue(j)) {
        const next = this.group(j + 1, forms);
        if (next && this.canContinue(j + 1)) current = next;
      } else {
        const next = this.group(j, forms);
        if (next) current = next;
      }
    }
    return { value: total + current.value, end: current.end, forms };
  }
}

function ordinalSuffix(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
}

export interface NumberSpan {
  start: number; // word index
  end: number; // exclusive word index
  digits: string;
  forms: Set<NumberForm>;
}

// Finds number spans in whitespace-split words. Spans never cut a word in half.
export function findNumberSpans(rawWords: string[]): NumberSpan[] {
  const { atoms, wordOfAtom } = atomsOf(rawWords);
  const parser = new Parser(atoms);
  const spans: NumberSpan[] = [];
  for (let i = 0; i < atoms.length;) {
    const parsed = parser.number(i);
    const startsWord = i === 0 || wordOfAtom[i - 1] !== wordOfAtom[i];
    const endsWord = parsed && (parsed.end === atoms.length || wordOfAtom[parsed.end] !== wordOfAtom[parsed.end - 1]);
    if (!parsed || !startsWord || !endsWord) {
      i++;
      continue;
    }
    const ordinal = atoms[parsed.end - 1].ordinal;
    const value = parsed.value;
    const digits = `${value >= 1000 ? value.toLocaleString('en-US') : value}${ordinal ? ordinalSuffix(value) : ''}`;
    spans.push({ start: wordOfAtom[i], end: wordOfAtom[parsed.end - 1] + 1, digits, forms: parsed.forms });
    i = parsed.end;
  }
  return addUp(spans, rawWords);
}

// The KJV adds numbers with "and" and lets a final scale word cover the sum: "an hundred and forty
// and four thousand" is 144,000, "fifty and nine thousand and three hundred" 59,300. The same rule
// as `numberChain` in lib/align.ts; an engine writing the total in digits is what the harness checks.
function addUp(spans: NumberSpan[], words: string[]): NumberSpan[] {
  const value = (span: NumberSpan) => (/^[\d,]+$/.test(span.digits) ? Number(span.digits.replace(/,/g, '')) : undefined);
  const lastPlace = (n: number) => {
    let place = 1;
    while (n % (place * 10) === 0) place *= 10;
    return place;
  };
  const out: NumberSpan[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    const a = prev && value(prev);
    const b = value(span);
    const joined = prev && span.start === prev.end + 1 && /^and$/i.test(words[prev.end]) && !/[^A-Za-z]$/.test(words[prev.end - 1]) &&
      !/^(hundred|thousand|million)/i.test(words[span.end] ?? ''); // "seven and thirty thousand": the parser left the scale out
    if (a && b && joined) {
      const scale = [1_000_000, 1000].find((s) => b >= s && Math.floor(b / s) < lastPlace(a) && a < s);
      const total = scale ? (a + Math.floor(b / scale)) * scale + (b % scale) : b < lastPlace(a) ? a + b : undefined;
      if (total) {
        out[out.length - 1] = { start: prev.start, end: span.end, digits: total >= 1000 ? total.toLocaleString('en-US') : String(total), forms: new Set([...prev.forms, ...span.forms]) };
        continue;
      }
    }
    out.push(span);
  }
  return out;
}

// Rewrite the spans selected by `pick` as digits, keeping the last word's trailing punctuation.
export function toDigits(
  text: string,
  pick: (forms: Set<NumberForm>, span: NumberSpan, all: NumberSpan[], words: string[]) => boolean,
): { text: string; changed: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  const found = findNumberSpans(words);
  const spans = found.filter((s) => pick(s.forms, s, found, words));
  if (spans.length === 0) return { text, changed: false };
  const out: string[] = [];
  let w = 0;
  for (const span of spans) {
    out.push(...words.slice(w, span.start));
    const lead = words[span.start].match(/^[^A-Za-z]*/)?.[0] ?? '';
    const trail = words[span.end - 1].match(/[^A-Za-z]*$/)?.[0] ?? '';
    out.push(`${lead}${span.digits}${trail}`);
    w = span.end;
  }
  out.push(...words.slice(w));
  return { text: out.join(' '), changed: true };
}

const ONES = ['', ...Object.keys(UNITS), ...Object.keys(TEENS)];
const TENS_WORDS = ['', '', ...Object.keys(TENS)];
function underThousand(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) out.push(ONES[Math.floor(n / 100)], 'hundred');
  const rest = n % 100;
  if (rest >= 20) out.push(TENS_WORDS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : ''));
  else if (rest > 0) out.push(ONES[rest]);
  return out;
}

// Digits in a verse ("2,172", "603,550") as a reader says them: "two thousand one hundred
// seventy-two". Integers only; ordinals ("2nd") and anything else stay as they are.
const DENOMINATORS: Record<string, string> = { '2': 'half', '3': 'third', '4': 'fourth', '8': 'eighth', '10': 'tenth' };

export function digitsToWords(text: string): { text: string; changed: boolean } {
  let changed = false;
  // Fractions as said: "87-1/2" is "87 and a half", "8-3/4" is "8 and three fourths".
  const fractions = text.replace(/\b(?:(\d+)[- ])?(\d)\/(\d+)\b/g, (m, whole: string | undefined, num: string, den: string) => {
    const name = DENOMINATORS[den];
    if (!name) return m;
    const part = num === '1' && den === '2' ? (whole ? 'a half' : 'one half') : `${underThousand(Number(num)).join(' ')} ${name}${num === '1' ? '' : 's'}`;
    return whole ? `${whole} and ${part}` : part;
  });
  const out = fractions.replace(/(?<!:)(\b\d{1,3}(,\d{3})+\b|\b\d+\b(?![,.:]?\d|st|nd|rd|th))/g, (m) => {
    const n = Number(m.replace(/,/g, ''));
    if (!Number.isSafeInteger(n) || n === 0 || n >= 1_000_000_000) return m;
    changed = true;
    const parts: string[] = [];
    if (n >= 1_000_000) parts.push(...underThousand(Math.floor(n / 1_000_000)), 'million');
    if (Math.floor(n / 1000) % 1000) parts.push(...underThousand(Math.floor(n / 1000) % 1000), 'thousand');
    parts.push(...underThousand(n % 1000));
    return parts.join(' ');
  });
  return { text: out, changed: changed || fractions !== text };
}
