/**
 * ESV API Adapter
 *
 * Handles fetching from the Crossway ESV API.
 * Returns clean JSON with bracketed verse numbers.
 */

import { BibleAdapter, VerseResult, ChapterResult } from "./types.ts";

const ESV_API_KEY = Deno.env.get("ESV_API_KEY");
const ESV_API_BASE = "https://api.esv.org/v3/passage/text/";

/**
 * Parse ESV chapter response
 * Format: "[1] In the beginning... [2] The earth was..."
 */
function parseChapter(
  text: string,
  expectedCount: number
): Record<string, string> {
  const verses: Record<string, string> = {};
  const pattern = /\[(\d+)\]\s*/g;

  const matches: { verseNum: string; startIndex: number }[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    matches.push({ verseNum: match[1], startIndex: match.index });
  }

  for (let i = 0; i < matches.length; i++) {
    const { verseNum, startIndex } = matches[i];
    const textStart = startIndex + `[${verseNum}]`.length;
    const textEnd =
      i < matches.length - 1 ? matches[i + 1].startIndex : text.length;
    // Collapse interior newlines/indentation from poetry formatting
    const verseText = text.substring(textStart, textEnd).replace(/\s+/g, " ").trim();
    verses[verseNum] = verseText;
  }

  // Validate
  const actualCount = Object.keys(verses).length;
  if (actualCount === 0) {
    console.error("=== ESV PARSE FAILURE ===");
    console.error("No verses found. Raw text:", text.substring(0, 2000));
    throw new Error("ESV parsing failed: no verses extracted");
  }

  if (actualCount !== expectedCount && expectedCount > 0) {
    console.warn(
      `ESV verse count: expected ${expectedCount}, got ${actualCount}`
    );
  }

  return verses;
}

export const esvAdapter: BibleAdapter = {
  id: "esv-api",
  name: "Crossway ESV API",
  supportedVersions: ["ESV"],

  async fetchVerse(ref: string, _version: string): Promise<VerseResult> {
    if (!ESV_API_KEY) {
      throw new Error("ESV_API_KEY not configured");
    }

    const params = new URLSearchParams({
      q: ref,
      "include-passage-references": "false",
      "include-verse-numbers": "false",
      "include-first-verse-numbers": "false",
      "include-footnotes": "false",
      "include-footnote-body": "false",
      "include-headings": "false",
      "include-short-copyright": "false",
      "include-selahs": "true",
      "indent-paragraphs": "0",
      "indent-poetry": "false",
    });

    const response = await fetch(`${ESV_API_BASE}?${params}`, {
      headers: { Authorization: `Token ${ESV_API_KEY}` },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("ESV API error:", error);
      throw new Error(`ESV API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.passages?.[0]?.replace(/\s+/g, " ").trim();

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
    if (!ESV_API_KEY) {
      throw new Error("ESV_API_KEY not configured");
    }

    const params = new URLSearchParams({
      q: ref,
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
    });

    const response = await fetch(`${ESV_API_BASE}?${params}`, {
      headers: { Authorization: `Token ${ESV_API_KEY}` },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("ESV API error:", error);
      throw new Error(`ESV API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.passages?.[0]?.trim();

    if (!text) {
      throw new Error("Chapter not found");
    }

    return { verses: parseChapter(text, expectedVerseCount) };
  },
};
