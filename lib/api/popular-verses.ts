import { supabase } from './client';

export interface PopularRange {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  userCount: number;
}

/**
 * Format a verse range for display
 * e.g., "John 3:16" or "John 3:16-18"
 */
export function formatRange(range: PopularRange): string {
  const { book, chapter, verseStart, verseEnd } = range;
  if (verseStart === verseEnd) {
    return `${book} ${chapter}:${verseStart}`;
  }
  return `${book} ${chapter}:${verseStart}-${verseEnd}`;
}

/**
 * Fetch the most popular verse ranges across all users
 * Data is precomputed by a cron job every 12 hours
 */
export async function getPopularRanges(limit = 10): Promise<PopularRange[]> {
  const { data, error } = await supabase
    .from('popular_ranges')
    .select('book, chapter, verse_start, verse_end, user_count')
    .order('user_count', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[API] Failed to fetch popular ranges:', error);
    return [];
  }

  return (data || []).map(r => ({
    book: r.book,
    chapter: r.chapter,
    verseStart: r.verse_start,
    verseEnd: r.verse_end,
    userCount: r.user_count,
  }));
}
