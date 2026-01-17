/**
 * Verse Search - Progressive Filtering
 *
 * Filters verses as user types, progressively narrowing results.
 * Each character only removes matches, never adds back.
 *
 * Examples:
 *   "j"        → all J books (John, James, Job, 1 John, etc.)
 *   "jo"       → John, Job, Joel, Jonah, Joshua, 1/2/3 John
 *   "john 3"   → John chapter 3, 1 John chapter 3, etc.
 *   "john 3:16"→ verses containing verse 16
 */

import type { SavedVerse } from './storage';

interface ParsedQuery {
  bookPrefix: string;
  chapter?: string;
  verse?: string;
}

/**
 * Parse search input into structured query
 * Handles flexible formats: "john 3:16", "john3:16", "john 3 16", etc.
 */
function parseQuery(input: string): ParsedQuery {
  const normalized = input
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')  // "john3" → "john 3"
    .replace(/[:\-–.]/g, ' ')           // "3:16" or "3-16" → "3 16"
    .replace(/\s+/g, ' ')               // collapse spaces
    .trim();

  const parts = normalized.split(' ');

  // Handle numbered books: "1 john" should stay as "1john" for prefix matching
  let bookPrefix = parts[0] || '';
  let restIndex = 1;

  // If first part is just a number and second part is letters, combine them
  if (/^\d$/.test(parts[0]) && parts[1] && /^[a-z]/.test(parts[1])) {
    bookPrefix = parts[0] + parts[1];
    restIndex = 2;
  }

  return {
    bookPrefix,
    chapter: parts[restIndex],
    verse: parts[restIndex + 1],
  };
}

/**
 * Check if book name matches the prefix
 * "jo" matches "John", "1 John", "Job", etc.
 * "1jo" matches "1 John" only
 */
function bookMatchesPrefix(book: string, prefix: string): boolean {
  if (!prefix) return true;

  const bookNorm = book.toLowerCase().replace(/\s/g, ''); // "1 John" → "1john"

  // Direct match: "1jo" matches "1john", "jo" matches "john"
  if (bookNorm.startsWith(prefix)) return true;

  // Strip leading number from book and try again
  // So "jo" can match "1john" (by matching "john" part)
  const bookWithoutNum = bookNorm.replace(/^\d/, '');
  if (bookWithoutNum.startsWith(prefix)) return true;

  return false;
}

/**
 * Check if any verse number in range starts with the prefix
 * Range 1-15 with prefix "1" matches (1, 10, 11, 12, 13, 14, 15)
 */
function verseRangeMatchesPrefix(start: number, end: number, prefix: string): boolean {
  if (!prefix) return true;

  for (let v = start; v <= end; v++) {
    if (v.toString().startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a verse matches the parsed query
 */
function matchesQuery(verse: SavedVerse, query: ParsedQuery): boolean {
  // Book prefix filter
  if (!bookMatchesPrefix(verse.book, query.bookPrefix)) {
    return false;
  }

  // Chapter filter (prefix match for partial typing)
  if (query.chapter !== undefined) {
    const chapterStr = verse.chapter.toString();
    if (!chapterStr.startsWith(query.chapter)) {
      return false;
    }
  }

  // Verse filter (check if any verse in range matches prefix)
  if (query.verse !== undefined) {
    if (!verseRangeMatchesPrefix(verse.verseStart, verse.verseEnd, query.verse)) {
      return false;
    }
  }

  return true;
}

/**
 * Filter verses by search query
 * Main export - use this in components
 */
export function filterVerses(verses: SavedVerse[], input: string): SavedVerse[] {
  const trimmed = input.trim();
  if (!trimmed) return verses;

  const query = parseQuery(trimmed);
  return verses.filter((v) => matchesQuery(v, query));
}
