/**
 * Reviews digest source.
 *
 * Daily (or weekly per user prefs), at the user's chosen wall-clock
 * time, sends one push naming up to one verse from their pool of
 * mastered + due-for-review verses, with a count of any others.
 *
 * Body composition:
 *   1 due  → "<Reference> is ready for review"
 *   2+ due → "<Hero reference> and N more ready for review"
 *
 * Hero pick: earliest engraved.nextDueAt asc (nulls = due-now → first),
 * then created_at asc, then id lexicographic. Deterministic across
 * reruns.
 *
 * Per-user error isolation: caller wraps each user in try/catch.
 * One bad row never blackholes the rest of the pass.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  formatLocalDate,
  loadTokens,
  localTimeInTz,
  logRow,
  type MatchedUser,
  sendToAllTokens,
  stampFired,
} from "./_shared.ts";

interface DueVerse {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  created_at: string;
  next_due_at: string | null;
}

/**
 * Pulls all enabled users (small dataset at Bread's scale — ~5 today,
 * tolerable up to low-thousands) and filters the time-match in TS
 * using Intl. Equivalent to the SQL match clause in the design doc:
 *
 *   SELECT user_id, timezone FROM notification_preferences
 *   WHERE master_enabled AND reviews_enabled
 *     AND extract(hour   FROM local_time_in_tz(tz)) = reviews_hour
 *     AND extract(minute FROM local_time_in_tz(tz)) = reviews_minute
 *     AND (cadence = 'daily' OR extract(dow ...) = reviews_weekday)
 *     AND (reviews_last_fired_local_date IS NULL
 *          OR reviews_last_fired_local_date < (local ...)::date)
 *
 * If the user base ever grows past a few thousand active prefs rows,
 * push this match into a SECURITY DEFINER SQL RPC for one-roundtrip
 * pruning. Not needed today.
 */
export async function dispatchReviewsDigest(
  admin: SupabaseClient,
): Promise<{ matched: number; sent: number; errors: number }> {
  const { data: prefs, error } = await admin
    .from("notification_preferences")
    .select(
      "user_id, timezone, reviews_cadence, reviews_weekday, reviews_hour, reviews_minute, reviews_last_fired_local_date",
    )
    .eq("master_enabled", true)
    .eq("reviews_enabled", true);

  if (error || !prefs) {
    console.error("[reviews] failed to load preferences", error);
    return { matched: 0, sent: 0, errors: 1 };
  }

  const now = new Date();
  const matched: MatchedUser[] = [];

  for (const p of prefs) {
    const local = localTimeInTz(now, p.timezone as string);
    if (!local) continue;
    if (local.getHours() !== p.reviews_hour) continue;
    if (local.getMinutes() !== p.reviews_minute) continue;
    if (p.reviews_cadence === "weekly") {
      if (local.getDay() !== p.reviews_weekday) continue;
    }
    const localDate = formatLocalDate(local);
    if (
      p.reviews_last_fired_local_date &&
      p.reviews_last_fired_local_date >= localDate
    ) {
      continue;
    }
    matched.push({ user_id: p.user_id as string, timezone: p.timezone as string });
  }

  let sent = 0;
  let errors = 0;
  for (const u of matched) {
    try {
      const result = await dispatchOne(admin, u);
      if (result === "sent") sent++;
    } catch (err) {
      errors++;
      console.error(
        `[reviews] per-user error for ${u.user_id}`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { matched: matched.length, sent, errors };
}

async function dispatchOne(
  admin: SupabaseClient,
  user: MatchedUser,
): Promise<"sent" | "skipped" | "error"> {
  const due = await loadDueVerses(admin, user.user_id);

  if (due.length === 0) {
    await logRow(admin, {
      user_id: user.user_id,
      source: "reviews",
      status: "skipped-empty",
    });
    await stampFired(admin, user.user_id, user.timezone, "reviews_last_fired_local_date");
    return "skipped";
  }

  const hero = due[0];
  const heroRef = formatRef(hero);
  const body = due.length === 1
    ? `${heroRef} is ready for review.`
    : `${heroRef} and ${due.length - 1} more ready for review.`;

  const tokens = await loadTokens(admin, user.user_id);
  if (tokens.length === 0) {
    await logRow(admin, {
      user_id: user.user_id,
      source: "reviews",
      status: "skipped-empty",
      body,
    });
    await stampFired(admin, user.user_id, user.timezone, "reviews_last_fired_local_date");
    return "skipped";
  }

  const anySent = await sendToAllTokens(
    admin,
    user.user_id,
    "reviews",
    {
      title: "Review time",
      body,
      data: { source: "reviews", target: "mastered" },
    },
    tokens,
  );

  // Only stamp last-fired if at least one push went through. Total
  // failure (every token errored) leaves the user eligible to retry
  // on the next pass — useful while iterating in early production.
  if (anySent) {
    await stampFired(admin, user.user_id, user.timezone, "reviews_last_fired_local_date");
  }
  return anySent ? "sent" : "error";
}

async function loadDueVerses(
  admin: SupabaseClient,
  userId: string,
): Promise<DueVerse[]> {
  // Mastered + (no schedule yet OR due now). The `progress` JSONB has
  // the shape: { hard: { completed: bool }, engraved: { nextDueAt:
  // string|null, ... } }. Verses with no engraved sub-object — pre-SR
  // legacy mastered verses — are treated as "due now" until the user
  // does a qualifying review (matches client behavior in
  // useReviewState at lib/store/index.ts:1090).
  const { data, error } = await admin
    .from("user_verses")
    .select("id, book, chapter, verse_start, verse_end, created_at, progress")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("progress->hard->completed", true);

  if (error) {
    throw new Error(`loadDueVerses failed: ${error.message}`);
  }
  if (!data) return [];

  const nowIso = new Date().toISOString();
  const due: DueVerse[] = [];
  for (const v of data) {
    const engraved = (v.progress as Record<string, unknown>)?.engraved as
      | Record<string, unknown>
      | undefined;
    const nextDueAt = engraved?.nextDueAt as string | null | undefined;
    const isDue = nextDueAt == null || nextDueAt <= nowIso;
    if (!isDue) continue;
    due.push({
      id: v.id as string,
      book: v.book as string,
      chapter: v.chapter as number,
      verse_start: v.verse_start as number,
      verse_end: v.verse_end as number,
      created_at: v.created_at as string,
      next_due_at: nextDueAt ?? null,
    });
  }

  // Hero pick: earliest nextDueAt (nulls sort FIRST as ""), then
  // created_at asc, then id lex. Nulls-first is intentional per
  // design doc edge case "Legacy null-nextDueAt mastered verses"
  // (notification-system.md:705) — pre-SR mastered verses surface
  // in every digest until the user does a qualifying review.
  due.sort((a, b) => {
    const an = a.next_due_at ?? "";
    const bn = b.next_due_at ?? "";
    if (an !== bn) return an < bn ? -1 : 1;
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return due;
}

function formatRef(v: DueVerse): string {
  if (v.verse_start === v.verse_end) {
    return `${v.book} ${v.chapter}:${v.verse_start}`;
  }
  return `${v.book} ${v.chapter}:${v.verse_start}-${v.verse_end}`;
}
