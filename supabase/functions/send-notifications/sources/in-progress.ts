/**
 * In-progress nudge source.
 *
 * Fires at the user's chosen wall-clock time on the days defined by
 * `in_progress_cadence` (daily / weekly+weekday), IF the user hasn't
 * foregrounded the app in 24h AND has at least one in-progress verse.
 * Schema mirrors reviews — cadence='daily' ⇒ weekday IS NULL,
 * cadence='weekly' ⇒ weekday∈0..6 (CHECK enforced).
 *
 * In-progress predicate mirrors `isInProgressVerse` at
 * `lib/store/index.ts:1043`: any non-null bestAccuracy on any
 * difficulty AND not yet mastered on Hard. Server- and client-side
 * definitions must stay in sync; the SQL parity comment lives in
 * chunk 6 alongside the cleanup pass.
 *
 * Body: "<Hero reference> is waiting — pick up where you left off."
 * Hero = most-recently-practiced in-progress verse
 * (last_practiced_at desc; ties → created_at desc; final tiebreaker
 * → id lex).
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

interface InProgressVerse {
  id: string;
  book: string;
  chapter: number;
  verse_start: number;
  verse_end: number;
  created_at: string;
  last_practiced_at: string | null;
}

const ACTIVE_GATE_MS = 24 * 60 * 60 * 1000;

export async function dispatchInProgress(
  admin: SupabaseClient,
): Promise<{ matched: number; sent: number; errors: number }> {
  const { data: prefs, error } = await admin
    .from("notification_preferences")
    .select(
      "user_id, timezone, in_progress_cadence, in_progress_weekday, in_progress_hour, in_progress_minute, in_progress_last_fired_local_date, last_foregrounded_at",
    )
    .eq("master_enabled", true)
    .eq("in_progress_enabled", true);

  if (error || !prefs) {
    console.error("[in-progress] failed to load preferences", error);
    return { matched: 0, sent: 0, errors: 1 };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const matched: MatchedUser[] = [];

  for (const p of prefs) {
    const local = localTimeInTz(now, p.timezone as string);
    if (!local) continue;
    if (p.in_progress_cadence === "weekly") {
      if (local.getDay() !== p.in_progress_weekday) continue;
    }
    if (local.getHours() !== p.in_progress_hour) continue;
    if (local.getMinutes() !== p.in_progress_minute) continue;

    // 24h-active gate. last_foregrounded_at is TIMESTAMPTZ; parse as
    // UTC instant.
    const lastFg = p.last_foregrounded_at
      ? new Date(p.last_foregrounded_at as string).getTime()
      : 0;
    if (nowMs - lastFg < ACTIVE_GATE_MS) continue;

    const localDate = formatLocalDate(local);
    if (
      p.in_progress_last_fired_local_date &&
      p.in_progress_last_fired_local_date >= localDate
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
        `[in-progress] per-user error for ${u.user_id}`,
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
  const verses = await loadInProgressVerses(admin, user.user_id);

  if (verses.length === 0) {
    await logRow(admin, {
      user_id: user.user_id,
      source: "in-progress",
      status: "skipped-empty",
    });
    await stampFired(admin, user.user_id, user.timezone, "in_progress_last_fired_local_date");
    return "skipped";
  }

  const hero = verses[0];
  const heroRef = formatRef(hero);
  const body = `${heroRef} is waiting — pick up where you left off.`;

  const tokens = await loadTokens(admin, user.user_id);
  if (tokens.length === 0) {
    await logRow(admin, {
      user_id: user.user_id,
      source: "in-progress",
      status: "skipped-empty",
      body,
    });
    await stampFired(admin, user.user_id, user.timezone, "in_progress_last_fired_local_date");
    return "skipped";
  }

  const anySent = await sendToAllTokens(
    admin,
    user.user_id,
    "in-progress",
    {
      title: "Keep going",
      body,
      data: { source: "in-progress", target: "in-progress" },
    },
    tokens,
  );

  if (anySent) {
    await stampFired(admin, user.user_id, user.timezone, "in_progress_last_fired_local_date");
  }
  return anySent ? "sent" : "error";
}

async function loadInProgressVerses(
  admin: SupabaseClient,
  userId: string,
): Promise<InProgressVerse[]> {
  // `progress` shape:
  //   { easy:{bestAccuracy,completed}, medium:{...}, hard:{...} }
  // Predicate (mirrors isInProgressVerse @ lib/store/index.ts:1043):
  //   hard.completed === false  (or missing)
  //   AND any of easy/medium/hard.bestAccuracy is non-null
  //
  // PostgREST can't express "any non-null" cleanly across three keys
  // in one filter, so we filter in TS after pulling unmastered rows.
  const { data, error } = await admin
    .from("user_verses")
    .select(
      "id, book, chapter, verse_start, verse_end, created_at, last_practiced_at, progress",
    )
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("progress->hard->completed", false);

  if (error) {
    throw new Error(`loadInProgressVerses failed: ${error.message}`);
  }
  if (!data) return [];

  const result: InProgressVerse[] = [];
  for (const v of data) {
    // hard.completed = false is enforced in the query above; here we
    // only check the "any non-null bestAccuracy" half of the
    // isInProgressVerse predicate (lib/store/index.ts:1043).
    const p = v.progress as Record<string, Record<string, unknown> | undefined>;
    const anyTouched =
      p?.easy?.bestAccuracy != null ||
      p?.medium?.bestAccuracy != null ||
      p?.hard?.bestAccuracy != null;
    if (!anyTouched) continue;
    result.push({
      id: v.id as string,
      book: v.book as string,
      chapter: v.chapter as number,
      verse_start: v.verse_start as number,
      verse_end: v.verse_end as number,
      created_at: v.created_at as string,
      last_practiced_at: (v.last_practiced_at as string | null) ?? null,
    });
  }

  // Hero pick: most-recent last_practiced_at (nulls last), then
  // created_at desc, then id lex. Surfaces the verse the user
  // was most recently working on.
  result.sort((a, b) => {
    const al = a.last_practiced_at;
    const bl = b.last_practiced_at;
    if (al && bl) return al < bl ? 1 : al > bl ? -1 : 0;
    if (al && !bl) return -1;
    if (!al && bl) return 1;
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return result;
}

function formatRef(v: InProgressVerse): string {
  if (v.verse_start === v.verse_end) {
    return `${v.book} ${v.chapter}:${v.verse_start}`;
  }
  return `${v.book} ${v.chapter}:${v.verse_start}-${v.verse_end}`;
}
