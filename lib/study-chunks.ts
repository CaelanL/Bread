import type { SavedVerse } from '@/lib/storage';

// ============================================================================
// Types
// ============================================================================

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DisplayWord {
  text: string;        // The actual word (including any leading superscript)
  isBlank: boolean;    // Whether it should be hidden initially
}

export interface Chunk {
  id: string; // Stable ID for FlatList keys
  verseNum: number;
  verseNumEnd?: number; // For multi-verse chunks
  text: string; // Original text (for evaluation)
  displayWords: DisplayWord[]; // Structured for word-by-word rendering
}

export interface AlignmentWord {
  word: string;
  status: 'correct' | 'close' | 'missing' | 'added';
  expected?: string; // For 'close' or 'missing' status
}

// ============================================================================
// Superscript & Annotation
// ============================================================================

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

/**
 * Convert a number to superscript characters
 */
export function toSuperscript(num: number): string {
  return String(num).split('').map(d => SUPERSCRIPTS[d] || d).join('');
}

/**
 * Add verse number annotation to text as superscript prefix
 */
export function annotateWithVerseNum(text: string, verseNum: number): string {
  return `${toSuperscript(verseNum)}${text}`;
}

// ============================================================================
// Verse Text Extraction
// ============================================================================

/**
 * Extract a single verse's text from a combined multi-verse string.
 *
 * DEPRECATED: This function uses sentence splitting which is broken for verses.
 * Use keyed verse data (verse.verses) instead when available.
 * This remains as a fallback for old cached data without keyed verses.
 */
export function getVerseText(fullText: string, index: number, total: number): string {
  if (total === 1) return fullText;

  // Try to split by sentence-like boundaries
  // WARNING: This is broken - sentences don't align with verses!
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  if (sentences.length >= total) {
    console.warn('[STUDY-CHUNKS] Using deprecated sentence splitting - keyed data not available');
    return sentences[index] || fullText;
  }

  // Fallback: split by words (also broken, but less so)
  console.warn('[STUDY-CHUNKS] Using deprecated word splitting - keyed data not available');
  const words = fullText.split(' ');
  const chunkSize = Math.ceil(words.length / total);
  const start = index * chunkSize;
  const end = start + chunkSize;
  return words.slice(start, end).join(' ');
}

// ============================================================================
// Difficulty Masking (Deterministic)
// ============================================================================

/**
 * Simple seeded random number generator (mulberry32)
 * Returns a function that produces deterministic values 0-1
 */
function seededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Apply difficulty masking to text, returning structured DisplayWord array.
 * - easy: all words visible (isBlank = false)
 * - medium: blank exactly 50% of words (alternating, seeded offset)
 * - hard: all words blanked (isBlank = true)
 *
 * @param text - The annotated text to mask
 * @param difficulty - easy | medium | hard
 * @param seed - Numeric seed for deterministic offset (0 or 1)
 */
export function applyDifficulty(text: string, difficulty: Difficulty, seed: number = 0): DisplayWord[] {
  const words = text.split(' ');

  if (difficulty === 'easy') {
    return words.map(word => ({ text: word, isBlank: false }));
  }

  if (difficulty === 'hard') {
    return words.map(word => ({ text: word, isBlank: true }));
  }

  // Medium: blank every other word, offset determined by seed
  const offset = seed % 2; // 0 or 1

  return words.map((word, i) => ({
    text: word,
    isBlank: i % 2 === offset,
  }));
}

// ============================================================================
// Chunk Parsing
// ============================================================================

/**
 * Annotate a full verse range using keyed verse data
 */
function annotateVerseRangeKeyed(
  verses: Record<string, string>,
  startVerse: number,
  endVerse: number
): string {
  const parts: string[] = [];
  for (let v = startVerse; v <= endVerse; v++) {
    const verseText = verses[v.toString()] || '';
    if (verseText) {
      parts.push(annotateWithVerseNum(verseText, v));
    }
  }
  return parts.join(' ');
}

/**
 * Annotate a full verse range (for when all verses are in one chunk)
 * DEPRECATED: Use annotateVerseRangeKeyed when keyed data is available
 */
function annotateVerseRange(fullText: string, startVerse: number, totalVerses: number): string {
  const parts: string[] = [];
  for (let i = 0; i < totalVerses; i++) {
    const verseText = getVerseText(fullText, i, totalVerses);
    parts.push(annotateWithVerseNum(verseText, startVerse + i));
  }
  return parts.join(' ');
}

/**
 * Parse a saved verse into chunks for study.
 * Each chunk gets a stable ID for FlatList keys.
 *
 * Uses keyed verse data (verse.verses) when available for correct alignment.
 * Falls back to deprecated sentence splitting for old cached data.
 *
 * @param verse - The saved verse to parse
 * @param difficulty - Difficulty level for display masking
 * @param chunkSize - Number of verses per chunk
 * @param sessionSeed - Seed for randomizing blanks (0 or 1)
 * @returns Array of chunks ready for study
 */
export function parseVerseIntoChunks(
  verse: SavedVerse,
  difficulty: Difficulty,
  chunkSize: number,
  sessionSeed: number = 0
): Chunk[] {
  const totalVerses = verse.verseEnd - verse.verseStart + 1;
  const text = verse.text || '';
  const hasKeyedData = verse.verses && Object.keys(verse.verses).length > 0;

  // If only one verse, return single chunk
  if (totalVerses === 1) {
    const verseText = hasKeyedData
      ? verse.verses![verse.verseStart.toString()] || text
      : text;
    const annotatedText = annotateWithVerseNum(verseText, verse.verseStart);
    const chunkId = `${verse.id}:${verse.verseStart}`;
    return [{
      id: chunkId,
      verseNum: verse.verseStart,
      text: verseText,
      displayWords: applyDifficulty(annotatedText, difficulty, hashString(chunkId) + sessionSeed),
    }];
  }

  // If chunkSize >= totalVerses, return all verses as one chunk
  if (chunkSize >= totalVerses) {
    const chunkId = `${verse.id}:${verse.verseStart}-${verse.verseEnd}`;

    if (hasKeyedData) {
      // Use keyed data for correct annotation
      const annotatedText = annotateVerseRangeKeyed(
        verse.verses!,
        verse.verseStart,
        verse.verseEnd
      );
      const combinedText = Object.values(verse.verses!).join(' ');
      return [{
        id: chunkId,
        verseNum: verse.verseStart,
        verseNumEnd: verse.verseEnd,
        text: combinedText,
        displayWords: applyDifficulty(annotatedText, difficulty, hashString(chunkId) + sessionSeed),
      }];
    }

    // Fallback: use deprecated sentence splitting
    const annotatedText = annotateVerseRange(text, verse.verseStart, totalVerses);
    return [{
      id: chunkId,
      verseNum: verse.verseStart,
      verseNumEnd: verse.verseEnd,
      text: text,
      displayWords: applyDifficulty(annotatedText, difficulty, hashString(chunkId) + sessionSeed),
    }];
  }

  // Get individual verse texts
  const verseTexts: { verseNum: number; text: string }[] = [];

  if (hasKeyedData) {
    // Use keyed data - correct!
    for (let v = verse.verseStart; v <= verse.verseEnd; v++) {
      const verseText = verse.verses![v.toString()] || '';
      verseTexts.push({ verseNum: v, text: verseText });
    }
  } else {
    // Fallback: deprecated sentence splitting
    for (let v = verse.verseStart; v <= verse.verseEnd; v++) {
      const verseText = getVerseText(text, v - verse.verseStart, totalVerses);
      verseTexts.push({ verseNum: v, text: verseText });
    }
  }

  // Group verses into chunks based on chunkSize
  const chunks: Chunk[] = [];
  for (let i = 0; i < verseTexts.length; i += chunkSize) {
    const chunkVerses = verseTexts.slice(i, i + chunkSize);
    const combinedText = chunkVerses.map(v => v.text).join(' ');
    const annotatedText = chunkVerses
      .map(v => annotateWithVerseNum(v.text, v.verseNum))
      .join(' ');
    const startVerse = chunkVerses[0].verseNum;
    const endVerse = chunkVerses[chunkVerses.length - 1].verseNum;

    const chunkId = endVerse !== startVerse
      ? `${verse.id}:${startVerse}-${endVerse}`
      : `${verse.id}:${startVerse}`;

    chunks.push({
      id: chunkId,
      verseNum: startVerse,
      verseNumEnd: endVerse !== startVerse ? endVerse : undefined,
      text: combinedText,
      displayWords: applyDifficulty(annotatedText, difficulty, hashString(chunkId) + sessionSeed),
    });
  }

  return chunks;
}

// ============================================================================
// Scoring
// ============================================================================

/**
 * Calculate score from a single alignment result
 */
export function calculateChunkScore(alignment: AlignmentWord[]): number {
  let correct = 0, close = 0, missing = 0, added = 0;

  for (const item of alignment) {
    if (item.status === 'correct') correct++;
    else if (item.status === 'close') close++;
    else if (item.status === 'missing') missing++;
    else if (item.status === 'added') added++;
  }

  const denominator = correct + close + missing + added;
  return denominator > 0 ? Math.round((correct + close * 0.5) / denominator * 100) : 0;
}

/**
 * Calculate final score from all chunk alignments
 */
export function calculateFinalScore(allAlignments: Map<number, AlignmentWord[]>): number {
  let totalCorrect = 0, totalClose = 0, totalMissing = 0, totalAdded = 0;

  allAlignments.forEach((alignment) => {
    for (const item of alignment) {
      if (item.status === 'correct') totalCorrect++;
      else if (item.status === 'close') totalClose++;
      else if (item.status === 'missing') totalMissing++;
      else if (item.status === 'added') totalAdded++;
    }
  });

  const totalDenom = totalCorrect + totalClose + totalMissing + totalAdded;
  return totalDenom > 0 ? Math.round((totalCorrect + totalClose * 0.5) / totalDenom * 100) : 0;
}

/**
 * Calculate score for a partial session (early exit).
 * Treats words from uncompleted chunks as missing.
 */
export function calculatePartialScore(
  chunks: Chunk[],
  completedChunks: Set<number>,
  chunkAlignments: Map<number, AlignmentWord[]>
): number {
  let totalCorrect = 0, totalClose = 0, totalMissing = 0, totalAdded = 0;

  // Add results from completed chunks
  chunkAlignments.forEach((alignment) => {
    for (const item of alignment) {
      if (item.status === 'correct') totalCorrect++;
      else if (item.status === 'close') totalClose++;
      else if (item.status === 'missing') totalMissing++;
      else if (item.status === 'added') totalAdded++;
    }
  });

  // Add words from uncompleted chunks as missing
  chunks.forEach((chunk, i) => {
    if (!completedChunks.has(i)) {
      totalMissing += chunk.text.split(/\s+/).filter(Boolean).length;
    }
  });

  const totalDenom = totalCorrect + totalClose + totalMissing + totalAdded;
  return totalDenom > 0 ? Math.round((totalCorrect + totalClose * 0.5) / totalDenom * 100) : 0;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Simple string hash for generating numeric seeds
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Results page item for FlatList
 */
export const RESULTS_PAGE_ID = '__results__';

export interface ResultsPageItem {
  id: typeof RESULTS_PAGE_ID;
  isResultsPage: true;
}

export function createResultsPageItem(): ResultsPageItem {
  return { id: RESULTS_PAGE_ID, isResultsPage: true };
}

/**
 * Type guard for results page item
 */
export function isResultsPage(item: Chunk | ResultsPageItem): item is ResultsPageItem {
  return 'isResultsPage' in item && item.isResultsPage === true;
}
