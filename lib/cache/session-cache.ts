/**
 * Session Cache
 *
 * In-memory cache for Bible verses. Cleared on app restart.
 * This is allowed under licensing terms (not persistent).
 */

// Chapter cache: "John:3:NLT" → { "1": "text", "2": "text", ... }
const chapterCache = new Map<string, Record<string, string>>();

// Single verse cache: "John:3:16:NLT" → "text"
const verseCache = new Map<string, string>();

// Saved verse range cache: "John:3:16-18:ESV" → "combined text"
const savedVerseCache = new Map<string, string>();

/**
 * Generate cache key for chapter
 */
function chapterKey(book: string, chapter: number, version: string): string {
  return `${book}:${chapter}:${version}`;
}

/**
 * Generate cache key for verse
 */
function verseKey(
  book: string,
  chapter: number,
  verse: number,
  version: string
): string {
  return `${book}:${chapter}:${verse}:${version}`;
}

/**
 * Get cached chapter
 */
export function getChapterFromSession(
  book: string,
  chapter: number,
  version: string
): Record<string, string> | null {
  const key = chapterKey(book, chapter, version);
  return chapterCache.get(key) || null;
}

/**
 * Cache a chapter
 */
export function setChapterInSession(
  book: string,
  chapter: number,
  version: string,
  verses: Record<string, string>
): void {
  const key = chapterKey(book, chapter, version);
  chapterCache.set(key, verses);

  // Also cache individual verses for single-verse lookups
  for (const [verseNum, text] of Object.entries(verses)) {
    const vKey = verseKey(book, chapter, parseInt(verseNum, 10), version);
    verseCache.set(vKey, text);
  }
}

/**
 * Get cached verse
 */
export function getVerseFromSession(
  book: string,
  chapter: number,
  verse: number,
  version: string
): string | null {
  const key = verseKey(book, chapter, verse, version);
  return verseCache.get(key) || null;
}

/**
 * Get cached verse range
 */
export function getVerseRangeFromSession(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  version: string
): string | null {
  const texts: string[] = [];

  for (let v = verseStart; v <= verseEnd; v++) {
    const text = getVerseFromSession(book, chapter, v, version);
    if (!text) return null; // Missing a verse, can't satisfy from cache
    texts.push(text);
  }

  return texts.join(" ");
}

/**
 * Cache a single verse
 */
export function setVerseInSession(
  book: string,
  chapter: number,
  verse: number,
  version: string,
  text: string
): void {
  const key = verseKey(book, chapter, verse, version);
  verseCache.set(key, text);
}

/**
 * Generate cache key for saved verse range
 */
function savedVerseKey(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  version: string
): string {
  return `${book}:${chapter}:${verseStart}-${verseEnd}:${version}`;
}

/**
 * Get cached saved verse text
 */
export function getSavedVerseFromSession(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  version: string
): string | null {
  const key = savedVerseKey(book, chapter, verseStart, verseEnd, version);
  return savedVerseCache.get(key) || null;
}

/**
 * Cache a saved verse's text
 */
export function setSavedVerseInSession(
  book: string,
  chapter: number,
  verseStart: number,
  verseEnd: number,
  version: string,
  text: string
): void {
  const key = savedVerseKey(book, chapter, verseStart, verseEnd, version);
  savedVerseCache.set(key, text);
}

/**
 * Clear all session cache
 */
export function clearSessionCache(): void {
  chapterCache.clear();
  verseCache.clear();
  savedVerseCache.clear();
}

/**
 * Get cache stats (for debugging)
 */
export function getSessionCacheStats(): {
  chapters: number;
  verses: number;
  savedVerses: number;
} {
  return {
    chapters: chapterCache.size,
    verses: verseCache.size,
    savedVerses: savedVerseCache.size,
  };
}
