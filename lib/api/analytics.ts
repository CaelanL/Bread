/**
 * Analytics API
 *
 * Functions for logging and querying session attempt data.
 */

import { supabase } from './client';
import type { Difficulty } from '@/lib/storage';

/**
 * Get local date string (YYYY-MM-DD) from a Date object
 */
function getLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

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
 */
export async function getCurrentStreak(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  // Get distinct practice days, ordered descending
  const { data, error } = await supabase
    .from('session_attempts')
    .select('created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error || !data || data.length === 0) return 0;

  // Get unique dates in user's local timezone
  const uniqueDates = [...new Set(
    data.map(row => getLocalDateString(new Date(row.created_at)))
  )].sort().reverse();

  if (uniqueDates.length === 0) return 0;

  // Check if most recent practice was today or yesterday (local time)
  const now = new Date();
  const today = getLocalDateString(now);
  const yesterday = getLocalDateString(new Date(now.getTime() - 86400000));

  if (uniqueDates[0] !== today && uniqueDates[0] !== yesterday) {
    // Streak broken - last practice was before yesterday
    return 0;
  }

  // Count consecutive days
  let streak = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    const currentDate = new Date(uniqueDates[i - 1]);
    const prevDate = new Date(uniqueDates[i]);
    const diffDays = Math.round((currentDate.getTime() - prevDate.getTime()) / 86400000);

    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Get total practice days count
 */
export async function getTotalPracticeDays(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase
    .from('session_attempts')
    .select('created_at')
    .eq('user_id', user.id);

  if (error || !data) return 0;

  // Use local timezone for date grouping
  const uniqueDates = new Set(
    data.map(row => getLocalDateString(new Date(row.created_at)))
  );

  return uniqueDates.size;
}

/**
 * Get total time studied in milliseconds
 */
export async function getTotalTimeStudied(): Promise<number> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { data, error } = await supabase
    .from('session_attempts')
    .select('recording_duration_ms')
    .eq('user_id', user.id);

  if (error || !data) return 0;

  return data.reduce((sum, row) => sum + (row.recording_duration_ms || 0), 0);
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
