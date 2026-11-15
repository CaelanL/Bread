/**
 * ESV API Adapter
 *
 * Handles fetching from the Crossway ESV API.
 * Parsing lives in esv-parse.ts.
 */

import { BibleAdapter, VerseResult, ChapterResult } from "./types.ts";
import { esvChapterQuery, parseEsvPassage } from "./esv-parse.ts";
import { VERSE_COUNTS } from "../verse-counts.ts";

const ESV_API_KEY = Deno.env.get("ESV_API_KEY");
const ESV_API_BASE = "https://api.esv.org/v3/passage/text/";

// Verse numbers on for both paths: one parser (esv-parse.ts) serves both, and
// the numbers let a single verse drop the psalm title or stanza name before
// it and notice a verse the ESV omits (Crossway answers with its neighbours).
const PARAMS = {
  "include-passage-references": "false",
  "include-verse-numbers": "true",
  "include-first-verse-numbers": "true",
  "include-footnotes": "false",
  "include-footnote-body": "false",
  "include-headings": "false",
  "include-short-copyright": "false",
  "include-selahs": "true",
  "indent-paragraphs": "0",
  "indent-poetry": "false",
};

async function fetchPassage(q: string): Promise<string> {
  if (!ESV_API_KEY) {
    throw new Error("ESV_API_KEY not configured");
  }

  const response = await fetch(`${ESV_API_BASE}?${new URLSearchParams({ q, ...PARAMS })}`, {
    headers: { Authorization: `Token ${ESV_API_KEY}` },
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("ESV API error:", error);
    throw new Error(`ESV API error: ${response.status}`);
  }

  const data = await response.json();
  return data.passages?.[0]?.trim() ?? "";
}

export const esvAdapter: BibleAdapter = {
  id: "esv-api",
  name: "Crossway ESV API",
  supportedVersions: ["ESV"],

  async fetchVerse(ref: string, _version: string): Promise<VerseResult> {
    const verse = ref.match(/:(\d+)$/)?.[1];
    const text = verse ? parseEsvPassage(await fetchPassage(ref))[verse] : undefined;

    // Absent: a verse the ESV omits (Matthew 18:11) or one past the end.
    // Never cached; the function answers it like any failed fetch.
    if (!text) {
      throw new Error("Verse not found");
    }

    return { text };
  },

  async fetchChapter(
    ref: string,
    _version: string,
    expectedVerseCount: number
  ): Promise<ChapterResult> {
    const counts = VERSE_COUNTS[ref.replace(/ \d+$/, "")] ?? [];
    const text = await fetchPassage(esvChapterQuery(ref, counts.length, counts[0] ?? 0));

    if (!text) {
      throw new Error("Chapter not found");
    }

    const verses = parseEsvPassage(text);
    const actualCount = Object.keys(verses).length;
    if (actualCount === 0) {
      console.error("=== ESV PARSE FAILURE ===");
      throw new Error("ESV parsing failed: no verses extracted");
    }
    if (actualCount !== expectedVerseCount && expectedVerseCount > 0) {
      console.warn(`ESV verse count: expected ${expectedVerseCount}, got ${actualCount}`);
    }

    return { verses };
  },
};
