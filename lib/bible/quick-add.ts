// lib-ok: Pure reference parser for the quick-add field; no UI, no store.
import { BIBLE_BOOKS } from './books';
import { BOOK_ALIASES, getChapterCount, getVerseCount } from './index';

export type QuickAddParse =
  | { kind: 'empty' }
  | { kind: 'book'; query: string; matches: string[] }
  | { kind: 'chapter'; book: string; chapter: number; verseCount: number }
  | { kind: 'verse'; book: string; chapter: number; verseStart: number; verseEnd: number }
  | {
      kind: 'error';
      reason: 'chapter';
      book: string;
      chapter: number;
      chapterCount: number;
      verseStart?: number;
      verseEnd?: number;
    }
  | {
      kind: 'error';
      reason: 'verse' | 'reversed' | 'cross-chapter';
      book: string;
      chapter: number;
      verseStart: number;
      verseEnd: number;
      verseCount: number;
    };

const squash = (text: string) => text.toLowerCase().replace(/\s+/g, '');

const ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(BOOK_ALIASES).map(([alias, book]) => [squash(alias), book]),
);

/** Books whose name starts with `prefix` (spaces ignored), or that `prefix` abbreviates. */
export function matchBooks(prefix: string): string[] {
  const key = squash(prefix);
  if (!key) return [];
  return BIBLE_BOOKS.filter((book) => squash(book).startsWith(key) || ALIASES[key] === book);
}

/** Splits the field text into the typed book part and everything after it. */
function splitBook(input: string): { query: string; rest: string } {
  const text = input.trimStart();
  const match = text.match(/^(\d\s*)?[a-z][a-z\s]*/i);
  if (!match) return { query: text.trim(), rest: '' };
  return { query: match[0].trim(), rest: text.slice(match[0].length) };
}

export function parseQuickAdd(input: string): QuickAddParse {
  if (!input.trim()) return { kind: 'empty' };

  const { query, rest } = splitBook(input);
  const matches = matchBooks(query);
  // parts alternates separator, number, separator, number, ...
  const parts = rest.split(/(\d+)/);
  const numbers = parts.filter((_, i) => i % 2 === 1).map(Number);
  if (matches.length !== 1 || numbers.length === 0) return { kind: 'book', query, matches };

  const book = matches[0];
  const [chapter, verseStart] = numbers;
  const chapterCount = getChapterCount(book);
  if (chapter < 1 || chapter > chapterCount) {
    return { kind: 'error', reason: 'chapter', book, chapter, chapterCount, verseStart, verseEnd: verseStart };
  }

  const verseCount = getVerseCount(book, chapter);
  if (numbers.length === 1) return { kind: 'chapter', book, chapter, verseCount };

  const isRange = numbers.length > 2 && /[-–—]/.test(parts[4]);
  const verseEnd = isRange ? numbers[2] : verseStart;
  const base = { kind: 'error' as const, book, chapter, verseStart, verseEnd, verseCount };
  if (numbers.length > 3 || (numbers.length === 3 && !isRange)) return { ...base, reason: 'cross-chapter' };
  if (verseStart < 1 || verseStart > verseCount || verseEnd > verseCount) return { ...base, reason: 'verse' };
  if (verseEnd < verseStart) return { ...base, reason: 'reversed' };
  return { kind: 'verse', book, chapter, verseStart, verseEnd };
}

/**
 * Replaces the typed book part with the full name plus one space, keeping any numbers
 * after it. Uses `book` when given, otherwise the only match; null when there isn't one.
 */
export function completeBook(input: string, book?: string): string | null {
  const { query, rest } = splitBook(input);
  const matches = matchBooks(query);
  const name = book ?? (matches.length === 1 ? matches[0] : null);
  if (!name) return null;
  return `${name} ${rest.trimStart()}`;
}

/** The one-line hint under the field. */
export function hintFor(parse: QuickAddParse): string | null {
  switch (parse.kind) {
    case 'empty':
      return null;
    case 'book':
      return parse.matches.length === 0 ? 'No book matches' : 'Space picks the only match · 2 5-7 for a range';
    case 'chapter':
      return `${parse.book} ${parse.chapter} has ${parse.verseCount} verses`;
    case 'verse': {
      const range = parse.verseEnd === parse.verseStart ? `${parse.verseStart}` : `${parse.verseStart}-${parse.verseEnd}`;
      return `Return adds ${parse.book} ${parse.chapter}:${range}`;
    }
    case 'error':
      switch (parse.reason) {
        case 'chapter':
          return `${parse.book} has ${parse.chapterCount} chapters`;
        case 'verse':
          return `${parse.book} ${parse.chapter} has ${parse.verseCount} verses`;
        case 'reversed':
          return `Start before end: try ${parse.chapter}:${parse.verseEnd}-${parse.verseStart}`;
        case 'cross-chapter':
          return `One chapter per verse: try ${parse.chapter}:${Math.min(parse.verseStart, parse.verseCount)}-${parse.verseCount}`;
      }
  }
}
