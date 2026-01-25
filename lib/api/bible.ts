import { getAuthToken, getSupabaseUrl } from "./client";
import {
  getChapterFromSession,
  setChapterInSession,
  getVerseRangeFromSession,
  setVerseInSession,
  getSavedVerseFromSession,
  setSavedVerseInSession,
  getSavedVerseKeyedFromSession,
  setSavedVerseKeyedInSession,
  clearSessionCache,
  getSessionCacheStats,
} from "../cache/session-cache";
import type { SavedVerse } from "../storage";

// Re-export for dev tools
export { clearSessionCache, getSessionCacheStats };

export type BibleVersion = "ESV" | "NLT" | "NIV" | "NKJV" | "CSB" | "KJV";

export interface BibleVerse {
  reference: string;
  version: BibleVersion;
  text: string;
  verses?: Record<string, string>; // Keyed data for ranges (e.g., { "15": "text", "16": "text" })
  cached: boolean;
}

/**
 * Result from getVerseText - provides both combined and keyed formats
 */
export interface VerseTextResult {
  text: string; // Combined text (for plain display)
  verses: Record<string, string>; // Keyed data (for annotated display)
}

export interface ChapterResponse {
  reference: string;
  version: BibleVersion;
  verses: Record<string, string>; // { "1": "text...", "2": "text..." }
  cached: boolean;
}

/**
 * Parse a reference string into components
 * "John 3:16" → { book: "John", chapter: 3, verse: 16 }
 * "John 3:16-18" → { book: "John", chapter: 3, verse: 16, verseEnd: 18 }
 */
function parseReference(ref: string): {
  book: string;
  chapter: number;
  verse?: number;
  verseEnd?: number;
} | null {
  const match = ref.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return null;

  const [, book, chapter, verse, verseEnd] = match;
  return {
    book,
    chapter: parseInt(chapter, 10),
    verse: verse ? parseInt(verse, 10) : undefined,
    verseEnd: verseEnd ? parseInt(verseEnd, 10) : undefined,
  };
}

/**
 * Fetch a verse from the Bible API
 *
 * @param reference - Verse reference (e.g., "John 3:16", "Psalm 23:1-6")
 * @param version - Bible version ("ESV" or "NLT")
 * @returns The verse text and metadata
 */
export async function fetchVerse(
  reference: string,
  version: BibleVersion = "ESV"
): Promise<BibleVerse> {
  // Check session cache first
  const parsed = parseReference(reference);
  if (parsed?.verse) {
    const verseEnd = parsed.verseEnd || parsed.verse;
    const cached = getVerseRangeFromSession(
      parsed.book,
      parsed.chapter,
      parsed.verse,
      verseEnd,
      version
    );
    if (cached) {
      return {
        reference,
        version,
        text: cached,
        cached: true,
      };
    }
  }

  // Fetch from API
  const token = await getAuthToken();
  const baseUrl = getSupabaseUrl();

  const params = new URLSearchParams({
    ref: reference,
    version,
  });

  const response = await fetch(`${baseUrl}/functions/v1/bible?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));

    if (response.status === 429) {
      throw new Error(
        `Daily limit reached. Resets at ${error.resetsAt || "midnight UTC"}`
      );
    }

    throw new Error(error.error || "Failed to fetch verse");
  }

  const result = await response.json();

  // Cache in session (if single verse, cache it; if range, cache each)
  if (parsed?.verse) {
    if (parsed.verseEnd) {
      // Range - we'd need individual verses to cache properly
      // For now, just cache the combined text as the start verse
      setVerseInSession(
        parsed.book,
        parsed.chapter,
        parsed.verse,
        version,
        result.text
      );
    } else {
      // Single verse
      setVerseInSession(
        parsed.book,
        parsed.chapter,
        parsed.verse,
        version,
        result.text
      );
    }
  }

  return result;
}

/**
 * Fetch multiple verses (convenience wrapper)
 */
export async function fetchVerses(
  references: string[],
  version: BibleVersion = "ESV"
): Promise<BibleVerse[]> {
  return Promise.all(references.map((ref) => fetchVerse(ref, version)));
}

/**
 * Fetch an entire chapter from the Bible API
 *
 * @param book - Book name (e.g., "John", "Genesis")
 * @param chapter - Chapter number
 * @param version - Bible version ("ESV" or "NLT")
 * @returns Object with verses mapped by verse number
 */
export async function fetchChapter(
  book: string,
  chapter: number,
  version: BibleVersion = "ESV"
): Promise<ChapterResponse> {
  // Check session cache first
  const cached = getChapterFromSession(book, chapter, version);
  if (cached) {
    return {
      reference: `${book} ${chapter}`,
      version,
      verses: cached,
      cached: true,
    };
  }

  // Fetch from API
  const token = await getAuthToken();
  const baseUrl = getSupabaseUrl();

  const reference = `${book} ${chapter}`;
  const params = new URLSearchParams({
    ref: reference,
    version,
    chapter: "true", // Signal to API this is a chapter request
  });

  const response = await fetch(`${baseUrl}/functions/v1/bible?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));

    if (response.status === 429) {
      throw new Error(
        `Daily limit reached. Resets at ${error.resetsAt || "midnight UTC"}`
      );
    }

    throw new Error(error.error || "Failed to fetch chapter");
  }

  const result = await response.json();

  // Cache in session
  if (result.verses) {
    setChapterInSession(book, chapter, version, result.verses);
  }

  return result;
}

/**
 * Get text for a saved verse - returns both combined and keyed formats
 *
 * Checks session cache first, then fetches from API (which checks verse_cache).
 * If the verse was evicted from cache, re-fetches from API.
 *
 * @param verse - The saved verse (may or may not have text/verses)
 * @returns Object with both text (combined) and verses (keyed)
 */
export async function getVerseText(verse: SavedVerse): Promise<VerseTextResult> {
  // If both formats already available, return them
  if (verse.text && verse.verses) {
    return { text: verse.text, verses: verse.verses };
  }

  // Check session cache for keyed data
  const sessionKeyedCached = getSavedVerseKeyedFromSession(
    verse.book,
    verse.chapter,
    verse.verseStart,
    verse.verseEnd,
    verse.version
  );

  // Check session cache for combined text
  const sessionTextCached = getSavedVerseFromSession(
    verse.book,
    verse.chapter,
    verse.verseStart,
    verse.verseEnd,
    verse.version
  );

  // If we have both from cache, return
  if (sessionKeyedCached && sessionTextCached) {
    return { text: sessionTextCached, verses: sessionKeyedCached };
  }

  // Build reference string
  const reference =
    verse.verseStart === verse.verseEnd
      ? `${verse.book} ${verse.chapter}:${verse.verseStart}`
      : `${verse.book} ${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`;

  // Fetch from API (which checks verse_cache internally, then external API)
  const result = await fetchVerse(reference, verse.version);

  // Handle single verse
  if (verse.verseStart === verse.verseEnd) {
    const keyed = { [verse.verseStart.toString()]: result.text };

    // Cache both formats
    setSavedVerseInSession(
      verse.book,
      verse.chapter,
      verse.verseStart,
      verse.verseEnd,
      verse.version,
      result.text
    );
    setSavedVerseKeyedInSession(
      verse.book,
      verse.chapter,
      verse.verseStart,
      verse.verseEnd,
      verse.version,
      keyed
    );

    return { text: result.text, verses: keyed };
  }

  // Handle range - API now returns both text and verses
  const keyed = result.verses || {};
  const text = result.text;

  // If API didn't return verses (old backend), construct keyed from text
  // This is a fallback during transition - should not happen after backend deploy
  if (Object.keys(keyed).length === 0) {
    console.warn("[BIBLE] API returned range without verses field - using fallback");
    setSavedVerseInSession(
      verse.book,
      verse.chapter,
      verse.verseStart,
      verse.verseEnd,
      verse.version,
      text
    );
    return { text, verses: { [verse.verseStart.toString()]: text } };
  }

  // Cache both formats
  setSavedVerseInSession(
    verse.book,
    verse.chapter,
    verse.verseStart,
    verse.verseEnd,
    verse.version,
    text
  );
  setSavedVerseKeyedInSession(
    verse.book,
    verse.chapter,
    verse.verseStart,
    verse.verseEnd,
    verse.version,
    keyed
  );

  return { text, verses: keyed };
}

/**
 * Format a verse reference string from SavedVerse
 */
export function formatReference(verse: SavedVerse): string {
  if (verse.verseStart === verse.verseEnd) {
    return `${verse.book} ${verse.chapter}:${verse.verseStart}`;
  }
  return `${verse.book} ${verse.chapter}:${verse.verseStart}-${verse.verseEnd}`;
}
