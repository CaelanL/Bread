/**
 * API Layer
 *
 * This module provides a clean interface to the Supabase Edge Functions.
 * All API keys are stored server-side - only the Supabase anon key is in the client.
 */

export { supabase, ensureAuth, getAuthToken } from "./client";
export { fetchVerse, fetchVerses, fetchChapter, type BibleVersion, type BibleVerse, type ChapterResponse } from "./bible";
export { processRecording, type ProcessRecordingResult } from "./recording";
export { logSessionAttempt, getCurrentStreak, getTotalPracticeDays, getTotalTimeStudied, getAvgTimeToMaster, type SessionAttemptData } from "./analytics";
