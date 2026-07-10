/**
 * Spaced-repetition review system constants.
 *
 * Tunables for the SR schedule and the engraved milestone. Per-verse SR
 * state lives in `user_verses.progress.engraved` (see lib/storage/index.ts);
 * the user-tunable interval cap lives in Zustand + AsyncStorage.
 */

export const ENGRAVED_THRESHOLD = 10;

export const DEFAULT_MAX_INTERVAL_DAYS = 90;
// 10 days is the natural interval before the final pre-engraving
// review (1+2+…+9 = 45 days through pass 9, then a 10-day gap to
// pass 10 = engraved). A cap below 10 would truncate that final
// interval and require *extra* reviews per period; 10 is the floor
// where the schedule reaches engraving without the cap clamping
// any pre-engraving step.
export const MIN_USER_MAX_INTERVAL_DAYS = 10;
export const MAX_USER_MAX_INTERVAL_DAYS = 365;
