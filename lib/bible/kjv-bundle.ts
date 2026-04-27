import type { BibleVerse, ChapterResponse } from "../api/bible";

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
  const data = load();
  const end = verseEnd ?? verse;
  const verses: Record<string, string> = {};
  const parts: string[] = [];

  for (let v = verse; v <= end; v++) {
    const text = data[makeKey(book, chapter, v)];
    if (!text) {
      throw new Error(`KJV verse not found in bundle: ${book} ${chapter}:${v}`);
    }
    verses[String(v)] = text;
    parts.push(text);
  }

  const reference =
    end === verse
      ? `${book} ${chapter}:${verse}`
      : `${book} ${chapter}:${verse}-${end}`;

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
  const data = load();
  const verses: Record<string, string> = {};
  const prefix = `${book} ${chapter}:`;

  for (const key of Object.keys(data)) {
    if (key.startsWith(prefix)) {
      const verseNum = key.slice(prefix.length);
      verses[verseNum] = data[key];
    }
  }

  if (Object.keys(verses).length === 0) {
    throw new Error(`KJV chapter not found in bundle: ${book} ${chapter}`);
  }

  return {
    reference: `${book} ${chapter}`,
    version: "KJV",
    verses,
    cached: true,
  };
}
