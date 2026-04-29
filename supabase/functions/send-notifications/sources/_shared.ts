/**
 * Helpers shared across notification sources.
 *
 * Time-match logic, log writes, token loads, last-fired stamping,
 * and the JS local-time-in-tz that mirrors the SQL helper.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendPush, type PushMessage, type PushOutcome } from "../push.ts";
import type {
  NotificationLogRow,
  NotificationSource,
} from "../types.ts";

type PushMessageBody = Omit<PushMessage, "to">;

export interface MatchedUser {
  user_id: string;
  timezone: string;
}

export interface DeviceTokenRow {
  expo_token: string;
}

/**
 * JS-side equivalent of the SQL `local_time_in_tz()` helper. Returns
 * a Date whose component accessors (getHours, getDay, etc.) reflect
 * local-clock values in the given IANA tz. The Date's UTC value is
 * not meaningful — only its component slots are.
 *
 * Returns null on invalid TZ. The caller skips that user; client
 * self-heals on next foreground TZ sync.
 */
export function localTimeInTz(now: Date, tz: string): Date | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const y = parseInt(get("year"), 10);
    const m = parseInt(get("month"), 10) - 1;
    const d = parseInt(get("day"), 10);
    let h = parseInt(get("hour"), 10);
    if (h === 24) h = 0; // some Intl impls return "24" for midnight
    const min = parseInt(get("minute"), 10);
    const s = parseInt(get("second"), 10);
    return new Date(y, m, d, h, min, s);
  } catch {
    return null;
  }
}

export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function loadTokens(
  admin: SupabaseClient,
  userId: string,
): Promise<DeviceTokenRow[]> {
  const { data, error } = await admin
    .from("device_tokens")
    .select("expo_token")
    .eq("user_id", userId);
  if (error) {
    // Throw so the per-user try/catch in the source dispatcher
    // increments errors and skips stamping. A transient DB blip
    // shouldn't cost the user that day's digest.
    throw new Error(`loadTokens failed: ${error.message}`);
  }
  return (data ?? []) as DeviceTokenRow[];
}

export async function logRow(
  admin: SupabaseClient,
  row: NotificationLogRow,
): Promise<void> {
  const { error } = await admin.from("notification_log").insert(row);
  if (error) {
    console.error("[notifications] failed to write log row", error);
  }
}

/**
 * Stamp the per-source last-fired column to today's local date for
 * the user. Idempotency hinge: the next pass's match SQL excludes
 * any row whose last-fired matches today.
 */
export async function stampFired(
  admin: SupabaseClient,
  userId: string,
  timezone: string,
  column: "reviews_last_fired_local_date" | "in_progress_last_fired_local_date",
): Promise<void> {
  const local = localTimeInTz(new Date(), timezone);
  if (!local) {
    // The match path also calls localTimeInTz for this user — if it
    // succeeded there but fails here, the TZ became invalid mid-pass
    // (tzdata reload, race). Skip the stamp; the user may retry next
    // minute and we'll see the error in logs.
    console.error(
      `[notifications] stamp skipped: invalid timezone ${timezone} for user ${userId}`,
    );
    return;
  }
  const localDate = formatLocalDate(local);
  const { error } = await admin
    .from("notification_preferences")
    .update({ [column]: localDate })
    .eq("user_id", userId);
  if (error) {
    console.error("[notifications] failed to stamp last-fired", error);
  }
}

/**
 * Send a push to every device token for the user, log per-token
 * outcomes, and clean up dead tokens. Returns true if at least one
 * push succeeded.
 */
export async function sendToAllTokens(
  admin: SupabaseClient,
  userId: string,
  source: NotificationSource,
  msg: PushMessageBody,
  tokens: DeviceTokenRow[],
): Promise<boolean> {
  let anySent = false;
  for (const t of tokens) {
    const outcome: PushOutcome = await sendPush({
      ...msg,
      to: t.expo_token,
    });

    if (outcome.status === "sent") {
      anySent = true;
      await logRow(admin, {
        user_id: userId,
        source,
        status: "sent",
        body: msg.body,
        expo_ticket: outcome.ticketId,
      });
    } else if (outcome.status === "token-error") {
      await admin.from("device_tokens").delete().eq("expo_token", t.expo_token);
      await logRow(admin, {
        user_id: userId,
        source,
        status: "token-error",
        body: msg.body,
        error: outcome.error,
      });
    } else {
      await logRow(admin, {
        user_id: userId,
        source,
        status: "send-error",
        body: msg.body,
        error: outcome.error,
      });
    }
  }
  return anySent;
}
