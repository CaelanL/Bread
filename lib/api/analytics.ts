/**
 * Analytics API
 *
 * Functions for logging and querying session attempt data.
 */

import { supabase } from './client';
import type { Difficulty } from '@/lib/storage';

export interface SessionAttemptData {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  version: string;
  difficulty: Difficulty;
  chunkSize: number;
  accuracy: number;
  recordingDurationMs?: number;
  wordCount?: number;
}

/**
 * Log a completed session attempt
 */
export async function logSessionAttempt(data: SessionAttemptData): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error('[ANALYTICS] Not authenticated, skipping attempt log');
    return;
  }

  const { error } = await supabase.from('session_attempts').insert({
    user_id: user.id,
    book: data.book,
    chapter: data.chapter,
    verse_start: data.verseStart,
    verse_end: data.verseEnd,
    version: data.version,
    difficulty: data.difficulty,
    chunk_size: data.chunkSize,
    accuracy: data.accuracy,
    recording_duration_ms: data.recordingDurationMs,
    word_count: data.wordCount,
  });

  if (error) {
    console.error('[ANALYTICS] Failed to log session attempt:', error);
  }
}

/**
 * Get current practice streak (consecutive days with at least one attempt)
 * Returns 0 if no attempts or streak broken
 * Uses SQL function for scalability - no need to fetch all rows
 */
export async function getCurrentStreak(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  // Get timezone offset in minutes (e.g., -300 for EST)
  const tzOffsetMin = new Date().getTimezoneOffset();

  const { data, error } = await supabase.rpc('get_current_streak', {
    p_user_id: user.id,
    p_tz_offset_min: tzOffsetMin,
  });

  if (error) {
    console.error('[ANALYTICS] Failed to get current streak:', error);
    return 0;
  }

  return data || 0;
}

/**
 * Get total time studied in milliseconds
 * Uses SQL SUM for scalability - no need to fetch all rows
 */
export async function getTotalTimeStudied(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase.rpc('get_total_time_studied', {
    p_user_id: user.id,
  });

  if (error) {
    console.error('[ANALYTICS] Failed to get total time studied:', error);
    return 0;
  }

  return data || 0;
}

/**
 * Get average time to master one verse (in ms for ~23 words)
 * Returns null if user doesn't have enough data yet
 */
export async function getAvgTimeToMaster(): Promise<number | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('user_stats')
    .select('avg_time_per_word_ms, total_words_mastered')
    .eq('user_id', user.id)
    .single();

  if (error || !data || !data.avg_time_per_word_ms) return null;

  // Multiply by 23 to get avg time for one verse (~23 words)
  return data.avg_time_per_word_ms * 23;
}
