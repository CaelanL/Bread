// lib-ok: Canonical reference-only monthly schedule; licensed Scripture text is fetched at runtime.
import type { CollectionPassage } from '@/lib/collections/catalog';

export const MONTHLY_PASSAGES = [
  { book: '1 Peter', chapter: 5, verseStart: 7, verseEnd: 7 },
  { book: 'Luke', chapter: 2, verseStart: 10, verseEnd: 11 },
  { book: 'Proverbs', chapter: 3, verseStart: 5, verseEnd: 6 },
  { book: '1 John', chapter: 4, verseStart: 19, verseEnd: 19 },
  { book: 'Romans', chapter: 5, verseStart: 8, verseEnd: 8 },
  { book: '1 Corinthians', chapter: 15, verseStart: 57, verseEnd: 57 },
  { book: 'Matthew', chapter: 6, verseStart: 33, verseEnd: 33 },
  { book: 'Galatians', chapter: 5, verseStart: 22, verseEnd: 23 },
  { book: 'Psalms', chapter: 119, verseStart: 105, verseEnd: 105 },
  { book: 'Isaiah', chapter: 40, verseStart: 31, verseEnd: 31 },
  { book: 'Joshua', chapter: 1, verseStart: 9, verseEnd: 9 },
  { book: 'Ephesians', chapter: 6, verseStart: 10, verseEnd: 11 },
  { book: 'Psalms', chapter: 107, verseStart: 1, verseEnd: 1 },
  { book: 'John', chapter: 1, verseStart: 14, verseEnd: 14 },
  { book: '2 Corinthians', chapter: 5, verseStart: 17, verseEnd: 17 },
  { book: 'John', chapter: 13, verseStart: 34, verseEnd: 35 },
  { book: 'Romans', chapter: 8, verseStart: 31, verseEnd: 31 },
  { book: 'John', chapter: 14, verseStart: 6, verseEnd: 6 },
  { book: 'John', chapter: 15, verseStart: 5, verseEnd: 5 },
  { book: 'Philippians', chapter: 4, verseStart: 4, verseEnd: 4 },
  { book: '2 Timothy', chapter: 1, verseStart: 7, verseEnd: 7 },
  { book: 'Colossians', chapter: 3, verseStart: 23, verseEnd: 24 },
  { book: 'James', chapter: 1, verseStart: 5, verseEnd: 5 },
  { book: 'Hebrews', chapter: 4, verseStart: 12, verseEnd: 12 },
  { book: 'Psalms', chapter: 100, verseStart: 4, verseEnd: 4 },
  { book: 'Isaiah', chapter: 9, verseStart: 6, verseEnd: 6 },
  { book: 'Lamentations', chapter: 3, verseStart: 22, verseEnd: 23 },
  { book: '1 Corinthians', chapter: 13, verseStart: 4, verseEnd: 5 },
  { book: 'Ephesians', chapter: 2, verseStart: 8, verseEnd: 9 },
  { book: 'Romans', chapter: 10, verseStart: 13, verseEnd: 13 },
  { book: 'Matthew', chapter: 28, verseStart: 19, verseEnd: 20 },
  { book: 'Psalms', chapter: 46, verseStart: 1, verseEnd: 1 },
  { book: 'James', chapter: 4, verseStart: 7, verseEnd: 7 },
  { book: 'Isaiah', chapter: 26, verseStart: 3, verseEnd: 3 },
  { book: 'Deuteronomy', chapter: 31, verseStart: 8, verseEnd: 8 },
  { book: '2 Thessalonians', chapter: 3, verseStart: 3, verseEnd: 3 },
] as const satisfies readonly CollectionPassage[];

export const MONTHLY_SCHEDULE = Array.from({ length: 120 }, (_, offset) => {
  const month = 10 + offset;
  return {
    yearMonth: `${2026 + Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`,
    ...MONTHLY_PASSAGES[offset % MONTHLY_PASSAGES.length],
  };
});
