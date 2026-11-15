// lib-ok: picks which verse text to warm; pure, so it's unit-tested
import type { SavedVerse } from '@/lib/storage';

/**
 * The verses whose text to warm, once each, most recently practiced first (never practiced last),
 * then newest. Nothing with Hide verses on (text loads at Setup), and no KJV (bundled, no request).
 */
export function pickPreload(verses: SavedVerse[], { hideVerseText }: { hideVerseText: boolean }): SavedVerse[] {
  if (hideVerseText) return [];
  const seen = new Set<string>();
  return verses
    .filter((v) => v.version !== 'KJV')
    .sort((a, b) => (b.lastPracticedAt ?? '').localeCompare(a.lastPracticedAt ?? '') || b.createdAt - a.createdAt)
    .filter((v) => {
      const key = `${v.version}:${v.book}:${v.chapter}:${v.verseStart}-${v.verseEnd}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
