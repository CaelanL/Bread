/**
 * Verse of the Month API
 * Fetches current month's VOTM and related stats
 */

import { supabase } from '@/lib/api/client';

export interface VOTM {
  id: string;
  yearMonth: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  imageUrl: string | null;
}

/**
 * Get the current month's Verse of the Month
 */
export async function getCurrentVOTM(): Promise<VOTM | null> {
  // Use local timezone, not UTC
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('verse_of_month')
    .select('*')
    .eq('year_month', yearMonth)
    .single();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    yearMonth: data.year_month,
    book: data.book,
    chapter: data.chapter,
    verseStart: data.verse_start,
    verseEnd: data.verse_end,
    imageUrl: data.image_url,
  };
}

/**
 * Get count of users who have mastered the VOTM (any Bible version)
 */
export async function getVOTMMasteryCount(votm: VOTM): Promise<number> {
  const { count, error } = await supabase
    .from('user_verses')
    .select('user_id', { count: 'exact', head: true })
    .eq('book', votm.book)
    .eq('chapter', votm.chapter)
    .eq('verse_start', votm.verseStart)
    .eq('verse_end', votm.verseEnd)
    .eq('progress->hard->completed', true);

  if (error) {
    console.error('[VOTM] Failed to get mastery count:', error);
    return 0;
  }

  return count ?? 0;
}

/**
 * Check if current user has mastered the VOTM (any Bible version)
 */
export async function hasUserMasteredVOTM(votm: VOTM): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_verses')
    .select('id')
    .eq('book', votm.book)
    .eq('chapter', votm.chapter)
    .eq('verse_start', votm.verseStart)
    .eq('verse_end', votm.verseEnd)
    .eq('progress->hard->completed', true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[VOTM] Failed to check user mastery:', error);
    return false;
  }

  return !!data;
}
