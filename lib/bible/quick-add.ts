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

export type QuickAddReference = { book: string; chapter: number; verseStart: number; verseEnd: number };

/** A row that rewrites the field to `text`, or one that adds a whole reference. */
export type QuickAddRow = { kind: 'fill'; text: string } | ({ kind: 'add' } & QuickAddReference);

export const MAX_ROWS = 6;

const firstNumbers = (count: number) => Array.from({ length: Math.min(count, MAX_ROWS) }, (_, i) => i + 1);

/** The suggestion rows for the field text, top row first. They narrow book, chapter, verse, range. */
export function quickAddRows(input: string): QuickAddRow[] {
  const parse = parseQuickAdd(input);
  switch (parse.kind) {
    case 'book': {
      const [book] = parse.matches;
      if (parse.matches.length === 1 && completeBook(input) === input) {
        return firstNumbers(getChapterCount(book)).map((chapter) => ({ kind: 'fill', text: `${book} ${chapter}` }));
      }
      return parse.matches.slice(0, MAX_ROWS).map((match) => ({ kind: 'fill', text: completeBook(input, match) ?? match }));
    }
    case 'chapter':
      return firstNumbers(parse.verseCount).map((verse) => ({ kind: 'fill', text: `${parse.book} ${parse.chapter}:${verse}` }));
    case 'verse': {
      const { book, chapter, verseStart, verseEnd } = parse;
      if (verseEnd !== verseStart) return [{ kind: 'add', book, chapter, verseStart, verseEnd }];
      return firstNumbers(getVerseCount(book, chapter) - verseStart + 1).map((length) => ({
        kind: 'add', book, chapter, verseStart, verseEnd: verseStart + length - 1,
      }));
    }
    default:
      return [];
  }
}
