/**
 * API.Bible Adapter
 *
 * Handles fetching from the API.Bible service (rest.api.bible).
 * Supports: NLT, NIV, NKJV.
 *
 * Note: KJV is NOT served from here — it's served client-side from
 * a bundled JSON (assets/bible/kjv-1769.json). See
 * docs/features/kjv-offline-bundle.md.
 */

import { BibleAdapter, VerseResult, ChapterResult } from "./types.ts";
import { parseApiBibleHtml } from "./apibible-parse.ts";

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

// HTML with verse numbers for both paths: one parser (apibible-parse.ts)
// serves both, and the numbers let a single verse drop the "Psalm N" heading
// or stanza letter before it.
const PARAMS = {
  "content-type": "html",
  "include-notes": "false",
  "include-titles": "false",
  "include-chapter-numbers": "false",
  "include-verse-numbers": "true",
  "include-verse-spans": "true",
};

async function fetchContent(version: string, path: string): Promise<string> {
  if (!API_BIBLE_KEY) {
    throw new Error("API_BIBLE_KEY not configured");
  }

  const bibleId = BIBLE_IDS[version];
  if (!bibleId) {
    throw new Error(`Unsupported version for API.Bible: ${version}`);
  }

  const response = await fetch(
    `${API_BIBLE_BASE}/bibles/${bibleId}/${path}?${new URLSearchParams(PARAMS)}`,
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
  return data.data?.content || "";
}

export const apiBibleAdapter: BibleAdapter = {
  id: "api-bible",
  name: "API.Bible",
  supportedVersions: Object.keys(BIBLE_IDS),

  async fetchVerse(ref: string, version: string): Promise<VerseResult> {
    const passageId = toApiBibleRef(ref);
    console.log(`API.Bible fetchVerse: "${ref}" → "${passageId}" (${version})`);

    const verse = ref.match(/:(\d+)$/)?.[1];
    const content = await fetchContent(version, `passages/${passageId}`);
    const text = verse ? parseApiBibleHtml(content)[verse] : undefined;

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
    const chapterId = toApiBibleRef(ref);
    console.log(`API.Bible fetchChapter: "${ref}" → "${chapterId}" (${version})`);

    const content = await fetchContent(version, `chapters/${chapterId}`);
    if (!content) {
      throw new Error(`Chapter not found: ${ref}`);
    }

    const verses = parseApiBibleHtml(content);
    const actualCount = Object.keys(verses).length;
    if (actualCount === 0) {
      console.error("=== API.Bible PARSE FAILURE ===");
      throw new Error("API.Bible parsing failed: no verses extracted");
    }
    if (actualCount !== expectedVerseCount && expectedVerseCount > 0) {
      console.warn(`API.Bible verse count: expected ${expectedVerseCount}, got ${actualCount}`);
    }

    return { verses };
  },
};
