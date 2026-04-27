import type { BibleVerse, ChapterResponse } from "../api/bible";
import { normalizeBookName } from "./index";

let bundle: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (bundle) return bundle;
  bundle = require("@/assets/bible/kjv-1769.json");
  return bundle!;
}

function makeKey(book: string, chapter: number, verse: number): string {
  return `${book} ${chapter}:${verse}`;
}

export function getKjvVerse(
  book: string,
  chapter: number,
  verse: number,
  verseEnd?: number
): BibleVerse {
  const canonicalBook = normalizeBookName(book);
  const data = load();
  const end = verseEnd ?? verse;
  if (end < verse) {
    throw new Error(`KJV invalid verse range: ${verse}-${end}`);
  }
  const verses: Record<string, string> = {};
  const parts: string[] = [];

  for (let v = verse; v <= end; v++) {
    const text = data[makeKey(canonicalBook, chapter, v)];
    if (!text) {
      throw new Error(`KJV verse not found in bundle: ${canonicalBook} ${chapter}:${v}`);
    }
    verses[String(v)] = text;
    parts.push(text);
  }

  const reference =
    end === verse
      ? `${canonicalBook} ${chapter}:${verse}`
      : `${canonicalBook} ${chapter}:${verse}-${end}`;

  return {
    reference,
    version: "KJV",
    text: parts.join(" "),
    verses,
    cached: true,
  };
}

export function getKjvChapter(
  book: string,
  chapter: number
): ChapterResponse {
  const canonicalBook = normalizeBookName(book);
  const data = load();
  const verses: Record<string, string> = {};
  const prefix = `${canonicalBook} ${chapter}:`;

  for (const key of Object.keys(data)) {
    if (key.startsWith(prefix)) {
      const verseNum = key.slice(prefix.length);
      verses[verseNum] = data[key];
    }
  }

  if (Object.keys(verses).length === 0) {
    throw new Error(`KJV chapter not found in bundle: ${canonicalBook} ${chapter}`);
  }

  return {
    reference: `${canonicalBook} ${chapter}`,
    version: "KJV",
    verses,
    cached: true,
  };
}
