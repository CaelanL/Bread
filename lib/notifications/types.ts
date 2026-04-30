/**
 * Client-side notification types.
 *
 * Mirrors the server-side `notification_preferences` row shape for a
 * single-source-of-truth view. The client treats this as the
 * Zustand-cached value of the user's prefs row; AsyncStorage is the
 * cross-launch cache.
 */

export type Cadence = 'daily' | 'weekly';

export interface NotificationPreferences {
  masterEnabled: boolean;

  reviewsEnabled: boolean;
  reviewsCadence: Cadence;
  /** 0 = Sunday, 6 = Saturday. Null when cadence === 'daily'. */
  reviewsWeekday: number | null;
  reviewsHour: number;     // 1..23 (1 AM through 11 PM)
  reviewsMinute: number;   // 0..59

  inProgressEnabled: boolean;
  inProgressCadence: Cadence;
  /** 0 = Sunday, 6 = Saturday. Null when cadence === 'daily'. */
  inProgressWeekday: number | null;
  inProgressHour: number;
  inProgressMinute: number;

  /** IANA TZ name. Always present once a row exists. */
  timezone: string;
}

export interface NotificationDeepLink {
  source: 'reviews' | 'in-progress';
  target: 'mastered' | 'in-progress';
}

/**
 * The four iOS permission states surfaced by expo-notifications.
 * `provisional` is iOS 12+ quiet-delivery (we don't request it
 * explicitly; only the OS grants it). For our toggle UX we treat it
 * as granted.
 */
export type IosPermissionStatus = 'undetermined' | 'granted' | 'provisional' | 'denied';
