/**
 * Bible API Adapter Types
 *
 * Common interfaces for all Bible API adapters.
 * Each adapter implements these to provide a consistent interface.
 */

/**
 * Standard verse response format (all adapters return this)
 */
export interface VerseResult {
  text: string;
  // Answered from a row the translation merges with the verse before (NLT "20-21"): not cached.
  merged?: boolean;
}

/**
 * Standard chapter response format (all adapters return this)
 */
export interface ChapterResult {
  verses: Record<string, string>; // { "1": "In the beginning...", "2": "..." }
}

/**
 * Adapter interface - each API implements this
 */
export interface BibleAdapter {
  /** Unique identifier for this adapter (e.g., "esv-api", "nlt-api") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Versions this adapter supports (e.g., ["ESV"] or ["NLT", "KJV"]) */
  supportedVersions: string[];

  /**
   * Fetch a single verse or verse range
   * @param ref - Normalized reference (e.g., "John 3:16", "1 Samuel 13:5-7")
   * @param version - Which version to fetch (must be in supportedVersions)
   */
  fetchVerse(ref: string, version: string): Promise<VerseResult>;

  /**
   * Fetch an entire chapter
   * @param ref - Normalized reference (e.g., "John 3", "1 Samuel 13")
   * @param version - Which version to fetch
   * @param expectedVerseCount - Expected number of verses for validation
   */
  fetchChapter(
    ref: string,
    version: string,
    expectedVerseCount: number
  ): Promise<ChapterResult>;
}
