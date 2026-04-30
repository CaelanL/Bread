/**
 * Supabase wrappers for notification-system tables.
 *
 * Per CLAUDE.md invariant 1, all writes to device_tokens and
 * notification_preferences go through this module. Components and
 * screens never touch supabase directly for these tables.
 */

import { Platform } from 'react-native';
import { supabase } from '@/lib/api/client';
import type { Cadence, NotificationPreferences } from './types';

const PREFS_TABLE = 'notification_preferences';
const TOKENS_TABLE = 'device_tokens';

interface PrefsRow {
  user_id: string;
  master_enabled: boolean;
  reviews_enabled: boolean;
  reviews_cadence: Cadence;
  reviews_weekday: number | null;
  reviews_hour: number;
  reviews_minute: number;
  in_progress_enabled: boolean;
  in_progress_cadence: Cadence;
  in_progress_weekday: number | null;
  in_progress_hour: number;
  in_progress_minute: number;
  timezone: string;
}

function rowToPrefs(row: PrefsRow): NotificationPreferences {
  return {
    masterEnabled: row.master_enabled,
    reviewsEnabled: row.reviews_enabled,
    reviewsCadence: row.reviews_cadence,
    reviewsWeekday: row.reviews_weekday,
    reviewsHour: row.reviews_hour,
    reviewsMinute: row.reviews_minute,
    inProgressEnabled: row.in_progress_enabled,
    // Old DB rows (pre-migration 019) won't have these columns.
    // Fall back to the prior hard-coded behavior so the new client
    // works against an un-migrated server during rollout.
    inProgressCadence: row.in_progress_cadence ?? 'weekly',
    inProgressWeekday: row.in_progress_weekday ?? 1,
    inProgressHour: row.in_progress_hour,
    inProgressMinute: row.in_progress_minute,
    timezone: row.timezone,
  };
}

function patchToRow(patch: Partial<NotificationPreferences>): Partial<PrefsRow> {
  const out: Partial<PrefsRow> = {};
  if (patch.masterEnabled !== undefined) out.master_enabled = patch.masterEnabled;
  if (patch.reviewsEnabled !== undefined) out.reviews_enabled = patch.reviewsEnabled;
  if (patch.reviewsCadence !== undefined) out.reviews_cadence = patch.reviewsCadence;
  if (patch.reviewsWeekday !== undefined) out.reviews_weekday = patch.reviewsWeekday;
  if (patch.reviewsHour !== undefined) out.reviews_hour = patch.reviewsHour;
  if (patch.reviewsMinute !== undefined) out.reviews_minute = patch.reviewsMinute;
  if (patch.inProgressEnabled !== undefined) out.in_progress_enabled = patch.inProgressEnabled;
  if (patch.inProgressCadence !== undefined) out.in_progress_cadence = patch.inProgressCadence;
  if (patch.inProgressWeekday !== undefined) out.in_progress_weekday = patch.inProgressWeekday;
  if (patch.inProgressHour !== undefined) out.in_progress_hour = patch.inProgressHour;
  if (patch.inProgressMinute !== undefined) out.in_progress_minute = patch.inProgressMinute;
  if (patch.timezone !== undefined) out.timezone = patch.timezone;
  return out;
}

/** Fetch the current user's prefs row, or null if not yet created. */
export async function fetchPreferences(): Promise<NotificationPreferences | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from(PREFS_TABLE)
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    console.error('[notifications] fetchPreferences', error);
    return null;
  }
  if (!data) return null;
  return rowToPrefs(data as PrefsRow);
}

/**
 * Single source of truth for the default preferences row shape.
 * Both `insertDefaultPreferences` and the page's local-draft seed
 * read from this so the no-prefs-yet Save path lands a row that
 * matches what the page rendered. Schema defaults stay in sync via
 * the migrations.
 */
export function defaultPreferences(timezone: string): NotificationPreferences {
  return {
    masterEnabled: true,
    reviewsEnabled: true,
    reviewsCadence: 'daily',
    reviewsWeekday: null,
    reviewsHour: 9,
    reviewsMinute: 0,
    inProgressEnabled: true,
    inProgressCadence: 'weekly',
    inProgressWeekday: 1,
    inProgressHour: 18,
    inProgressMinute: 0,
    timezone,
  };
}

/**
 * Insert the user's first prefs row with sane defaults. Called when
 * permission is freshly granted. Returns the resulting prefs.
 */
export async function insertDefaultPreferences(timezone: string): Promise<NotificationPreferences | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const defaults = defaultPreferences(timezone);
  const row: PrefsRow = {
    user_id: user.id,
    master_enabled: defaults.masterEnabled,
    reviews_enabled: defaults.reviewsEnabled,
    reviews_cadence: defaults.reviewsCadence,
    reviews_weekday: defaults.reviewsWeekday,
    reviews_hour: defaults.reviewsHour,
    reviews_minute: defaults.reviewsMinute,
    in_progress_enabled: defaults.inProgressEnabled,
    in_progress_cadence: defaults.inProgressCadence,
    in_progress_weekday: defaults.inProgressWeekday,
    in_progress_hour: defaults.inProgressHour,
    in_progress_minute: defaults.inProgressMinute,
    timezone: defaults.timezone,
  };
  const { data, error } = await supabase
    .from(PREFS_TABLE)
    .insert(row)
    .select()
    .single();
  if (error) {
    console.error('[notifications] insertDefaultPreferences', error);
    return null;
  }
  return rowToPrefs(data as PrefsRow);
}

/** UPDATE the user's prefs row. Caller does optimistic update upstream. */
export async function updatePreferences(patch: Partial<NotificationPreferences>): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const rowPatch = patchToRow(patch);
  if (Object.keys(rowPatch).length === 0) return true;
  const { error } = await supabase
    .from(PREFS_TABLE)
    .update(rowPatch)
    .eq('user_id', user.id);
  if (error) {
    console.error('[notifications] updatePreferences', error);
    return false;
  }
  return true;
}

/**
 * UPSERT a device token. UNIQUE(expo_token) on the table makes
 * ownership transfer atomic — if a different user previously had this
 * token, their row's user_id flips to the current user (privacy: no
 * ghost-pushes).
 */
export async function upsertDeviceToken(expoToken: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from(TOKENS_TABLE)
    .upsert(
      {
        user_id: user.id,
        expo_token: expoToken,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'expo_token' },
    );
  if (error) {
    console.error('[notifications] upsertDeviceToken', error);
    return false;
  }
  return true;
}

/** DELETE this device's token row (e.g., on permission revocation). */
export async function deleteDeviceToken(expoToken: string): Promise<boolean> {
  const { error } = await supabase
    .from(TOKENS_TABLE)
    .delete()
    .eq('expo_token', expoToken);
  if (error) {
    console.error('[notifications] deleteDeviceToken', error);
    return false;
  }
  return true;
}

/**
 * Idempotent foreground heartbeat. Server-side debounced via the
 * `WHERE now() - last_foregrounded_at > INTERVAL '5 minutes'` clause
 * — calling this on every foreground is safe; Postgres no-ops on
 * recent calls. Tied to the in-progress 24h-active gate.
 */
export async function updateLastForegroundedAt(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase
    .from(PREFS_TABLE)
    .update({ last_foregrounded_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .lt('last_foregrounded_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
  if (error) {
    console.error('[notifications] updateLastForegroundedAt', error);
  }
}

/** UPDATE the timezone. Called when the device TZ changes (travel). */
export async function updateTimezone(timezone: string): Promise<boolean> {
  return updatePreferences({ timezone });
}
