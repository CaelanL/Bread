/**
 * API.Bible Adapter
 *
 * Handles fetching from the API.Bible service (rest.api.bible).
 * Supports: NLT, NIV, NKJV, KJV, and other translations.
 */

import { BibleAdapter, VerseResult, ChapterResult } from "./types.ts";

const API_BIBLE_KEY = Deno.env.get("API_BIBLE_KEY");
const API_BIBLE_BASE = "https://rest.api.bible/v1";

/**
 * Bible ID mapping for supported versions
 * Format: version abbreviation → api.bible ID
 */
const BIBLE_IDS: Record<string, string> = {
  NLT: "d6e14a625393b4da-01",
  NIV: "78a9f6124f344018-01",
  NKJV: "63097d2a0a2f7db3-01",
  KJV: "a6aee10bb058511c-02", // King James Version, American Edition
};

/**
 * Book name to API.Bible book ID mapping
 * Standard USFM book codes (3-letter uppercase)
 */
const BOOK_IDS: Record<string, string> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Joshua: "JOS",
  Judges: "JDG",
  Ruth: "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  Ezra: "EZR",
  Nehemiah: "NEH",
  Esther: "EST",
  Job: "JOB",
  Psalms: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Solomon": "SNG",
  Isaiah: "ISA",
  Jeremiah: "JER",
  Lamentations: "LAM",
  Ezekiel: "EZK",
  Daniel: "DAN",
  Hosea: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obadiah: "OBA",
  Jonah: "JON",
  Micah: "MIC",
  Nahum: "NAM",
  Habakkuk: "HAB",
  Zephaniah: "ZEP",
  Haggai: "HAG",
  Zechariah: "ZEC",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  Titus: "TIT",
  Philemon: "PHM",
  Hebrews: "HEB",
  James: "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  Jude: "JUD",
  Revelation: "REV",
};

/**
 * Convert normalized reference to API.Bible format
 * "John 3:16" → "JHN.3.16"
 * "1 Samuel 13:5-7" → "1SA.13.5-1SA.13.7"
 * "John 3" → "JHN.3"
 */
function toApiBibleRef(ref: string): string {
  const match = ref.match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return ref;

  const [, book, chapter, verse, verseEnd] = match;
  const bookId = BOOK_IDS[book] || book.toUpperCase().substring(0, 3);

  if (!verse) {
    // Chapter only: "John 3" → "JHN.3"
    return `${bookId}.${chapter}`;
  }

  if (verseEnd) {
    // Range: "John 3:16-18" → "JHN.3.16-JHN.3.18"
    return `${bookId}.${chapter}.${verse}-${bookId}.${chapter}.${verseEnd}`;
  }

  // Single verse: "John 3:16" → "JHN.3.16"
  return `${bookId}.${chapter}.${verse}`;
}

/**
 * Clean HTML/text from API.Bible response
 * Removes HTML tags and normalizes whitespace
 */
function cleanText(content: string): string {
  return content
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Parse chapter response into verse map
 * Expects content with verse markers like [1] or <span class="v">1</span>
 */
function parseChapterContent(
  content: string,
  expectedCount: number
): Record<string, string> {
  const verses: Record<string, string> = {};

  // API.Bible returns HTML with data-usfm attributes or verse spans
  // Try parsing by verse number patterns

  // Pattern 1: Look for verse number spans or markers
  // The API returns content with verse markers embedded
  const versePattern = /(?:<span[^>]*data-number="(\d+)"[^>]*>|<sup[^>]*>(\d+)<\/sup>|\[(\d+)\])/gi;

  let lastIndex = 0;
  let lastVerseNum: string | null = null;
  const matches: { verseNum: string; startIndex: number }[] = [];
  let match;

  // Reset the pattern
  versePattern.lastIndex = 0;

  while ((match = versePattern.exec(content)) !== null) {
    const verseNum = match[1] || match[2] || match[3];
    matches.push({ verseNum, startIndex: match.index });
  }

  // Extract text between markers
  for (let i = 0; i < matches.length; i++) {
    const { verseNum, startIndex } = matches[i];
    const textStart = startIndex;
    const textEnd = i < matches.length - 1 ? matches[i + 1].startIndex : content.length;

    // Get text after the marker
    let verseText = content.substring(textStart, textEnd);
    // Remove the marker itself
    verseText = verseText.replace(/^(?:<span[^>]*data-number="\d+"[^>]*>.*?<\/span>|<sup[^>]*>\d+<\/sup>|\[\d+\])\s*/i, "");
    verseText = cleanText(verseText);

    if (verseText) {
      verses[verseNum] = verseText;
    }
  }

  // If no verses found with patterns, try a simpler approach
  if (Object.keys(verses).length === 0) {
    // Just return the cleaned content as verse 1 if nothing else works
    const cleaned = cleanText(content);
    if (cleaned && expectedCount === 1) {
      verses["1"] = cleaned;
    }
  }

  const actualCount = Object.keys(verses).length;
  if (actualCount !== expectedCount && expectedCount > 0) {
    console.warn(`API.Bible verse count: expected ${expectedCount}, got ${actualCount}`);
  }

  return verses;
}

export const apiBibleAdapter: BibleAdapter = {
  id: "api-bible",
  name: "API.Bible",
  supportedVersions: Object.keys(BIBLE_IDS),

  async fetchVerse(ref: string, version: string): Promise<VerseResult> {
    if (!API_BIBLE_KEY) {
      throw new Error("API_BIBLE_KEY not configured");
    }

    const bibleId = BIBLE_IDS[version];
    if (!bibleId) {
      throw new Error(`Unsupported version for API.Bible: ${version}`);
    }

    const passageId = toApiBibleRef(ref);
    console.log(`API.Bible fetchVerse: "${ref}" → "${passageId}" (${version})`);

    const params = new URLSearchParams({
      "content-type": "text",
      "include-notes": "false",
      "include-titles": "false",
      "include-chapter-numbers": "false",
      "include-verse-numbers": "false",
      "include-verse-spans": "false",
    });

    const response = await fetch(
      `${API_BIBLE_BASE}/bibles/${bibleId}/passages/${passageId}?${params}`,
      {
        headers: { "api-key": API_BIBLE_KEY },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("API.Bible error:", error);
      throw new Error(`API.Bible error: ${response.status}`);
    }

    const data = await response.json();
    const text = cleanText(data.data?.content || "");

    if (!text) {
      throw new Error(`Verse not found: ${ref}`);
    }

    return { text };
  },

  async fetchChapter(
    ref: string,
    version: string,
    expectedVerseCount: number
  ): Promise<ChapterResult> {
    if (!API_BIBLE_KEY) {
      throw new Error("API_BIBLE_KEY not configured");
    }

    const bibleId = BIBLE_IDS[version];
    if (!bibleId) {
      throw new Error(`Unsupported version for API.Bible: ${version}`);
    }

    const chapterId = toApiBibleRef(ref);
    console.log(`API.Bible fetchChapter: "${ref}" → "${chapterId}" (${version})`);

    const params = new URLSearchParams({
      "content-type": "html",
      "include-notes": "false",
      "include-titles": "false",
      "include-chapter-numbers": "false",
      "include-verse-numbers": "true",
      "include-verse-spans": "true",
    });

    const response = await fetch(
      `${API_BIBLE_BASE}/bibles/${bibleId}/chapters/${chapterId}?${params}`,
      {
        headers: { "api-key": API_BIBLE_KEY },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("API.Bible error:", error);
      throw new Error(`API.Bible error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.data?.content || "";

    if (!content) {
      throw new Error(`Chapter not found: ${ref}`);
    }

    const verses = parseChapterContent(content, expectedVerseCount);

    if (Object.keys(verses).length === 0) {
      console.error("=== API.Bible PARSE FAILURE ===");
      console.error("No verses found. Raw content (first 2000 chars):");
      console.error(content.substring(0, 2000));
      throw new Error("API.Bible parsing failed: no verses extracted");
    }

    return { verses };
  },
};
