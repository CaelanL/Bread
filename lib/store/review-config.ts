/**
 * Spaced-repetition review system constants.
 *
 * Tunables for the SR schedule and the engraved milestone. Per-verse SR
 * state lives in `user_verses.progress.engraved` (see lib/storage/index.ts);
 * the user-tunable interval cap lives in Zustand + AsyncStorage.
 */

export const ENGRAVED_THRESHOLD = 10;

export const DEFAULT_MAX_INTERVAL_DAYS = 90;
export const MIN_USER_MAX_INTERVAL_DAYS = 30;
export const MAX_USER_MAX_INTERVAL_DAYS = 365;
