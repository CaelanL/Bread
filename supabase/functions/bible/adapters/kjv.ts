/**
 * KJV Adapter (Local)
 *
 * Serves KJV 1769 Cambridge Edition from bundled JSON.
 * No external API calls - instant lookups.
 */

import { BibleAdapter, VerseResult, ChapterResult } from "./types.ts";

// Load KJV data from bundled JSON
// Path is relative to the edge function location
const kjvData = await Deno.readTextFile(
  new URL("../../../../assets/bible/kjv-1769.json", import.meta.url)
);
const kjvVerses: Record<string, string> = JSON.parse(kjvData);

/**
 * Clean KJV text:
 * - Remove # (paragraph markers)
 * - Remove [...] brackets but keep the text inside (italics markers)
 */
function cleanText(text: string): string {
  return text
    .replace(/^#\s*/, "") // Remove leading paragraph mark
    .replace(/\[([^\]]+)\]/g, "$1"); // Remove brackets, keep content
}

export const kjvAdapter: BibleAdapter = {
  id: "kjv-local",
  name: "King James Version (1769)",
  supportedVersions: ["KJV"],

  async fetchVerse(ref: string, _version: string): Promise<VerseResult> {
    // Handle verse ranges like "John 3:16-18"
    const rangeMatch = ref.match(/^(.+\s+\d+):(\d+)-(\d+)$/);
    if (rangeMatch) {
      const [, baseRef, startStr, endStr] = rangeMatch;
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      const texts: string[] = [];

      for (let v = start; v <= end; v++) {
        const key = `${baseRef}:${v}`;
        const text = kjvVerses[key];
        if (text) {
          texts.push(cleanText(text));
        }
      }

      if (texts.length === 0) {
        throw new Error(`Verse range not found: ${ref}`);
      }

      return { text: texts.join(" ") };
    }

    // Single verse
    const text = kjvVerses[ref];
    if (!text) {
      throw new Error(`Verse not found: ${ref}`);
    }

    return { text: cleanText(text) };
  },

  async fetchChapter(
    ref: string,
    _version: string,
    expectedVerseCount: number
  ): Promise<ChapterResult> {
    // ref is like "John 3" or "1 Samuel 13"
    const verses: Record<string, string> = {};

    for (let v = 1; v <= expectedVerseCount; v++) {
      const key = `${ref}:${v}`;
      const text = kjvVerses[key];
      if (text) {
        verses[v.toString()] = cleanText(text);
      }
    }

    if (Object.keys(verses).length === 0) {
      throw new Error(`Chapter not found: ${ref}`);
    }

    return { verses };
  },
};
