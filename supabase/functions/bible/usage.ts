import { getAdminClient, getUserTier } from "../_shared/auth.ts";

// The daily Bible read limits, only here: a change redeploys only `bible`.
const DAILY_LIMIT = { free: 100, supporter: 10_000 };

export interface BibleUsage {
  userId: string;
  date: string;
  rowId: string | null;
  used: number;
  limit: number;
}

/** Today's count and the user's limit: the tier and the `usage_daily` row, read together. */
export async function readBibleUsage(userId: string): Promise<BibleUsage> {
  const date = new Date().toISOString().split("T")[0];
  const [tier, { data }] = await Promise.all([
    getUserTier(userId),
    getAdminClient()
      .from("usage_daily")
      .select("id, bible_fetch_count")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle(),
  ]);
  return {
    userId,
    date,
    rowId: data?.id ?? null,
    used: data?.bible_fetch_count ?? 0,
    limit: DAILY_LIMIT[tier],
  };
}

/** Counts one fetch on the row `readBibleUsage` found (no second read). */
export async function countBibleFetch(usage: BibleUsage): Promise<void> {
  const admin = getAdminClient();
  if (usage.rowId) {
    await admin
      .from("usage_daily")
      .update({ bible_fetch_count: usage.used + 1 })
      .eq("id", usage.rowId);
  } else {
    await admin.from("usage_daily").insert({
      user_id: usage.userId,
      date: usage.date,
      bible_fetch_count: 1,
    });
  }
}
