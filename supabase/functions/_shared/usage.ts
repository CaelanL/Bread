import { getAdminClient, getUserTier } from "./auth.ts";
import { rateLimited } from "./errors.ts";

type UsageType = "transcribe_seconds" | "evaluate_count" | "bible_fetch_count";
type Tier = "free" | "supporter";

/**
 * Usage limits by tier
 */
const LIMITS = {
  free: {
    transcribe_seconds: 300, // 5 minutes/day
    evaluate_count: 20, // 20 evaluations/day
    bible_fetch_count: 100, // 100 fetches/day
  },
  supporter: {
    transcribe_seconds: 3600, // 1 hour/day
    evaluate_count: 500, // 500 evaluations/day
    bible_fetch_count: 10000, // 10k fetches/day
  },
};

interface UsageResult {
  allowed: boolean;
  used: number;
  limit: number;
}

interface TierAndUsage {
  tier: Tier;
  used: number;
  limit: number;
}

/**
 * Get tier and usage in a single DB query
 * Saves ~100-200ms (1 query instead of 2)
 */
export async function getTierAndUsage(
  userId: string,
  usageType: UsageType = "transcribe_seconds"
): Promise<TierAndUsage> {
  const admin = getAdminClient();
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await admin
    .rpc("get_tier_and_usage", {
      p_user_id: userId,
      p_date: today,
      p_usage_type: usageType,
    });

  if (error || !data || data.length === 0) {
    // Default to free tier with 0 usage
    return {
      tier: "free",
      used: 0,
      limit: LIMITS.free[usageType],
    };
  }

  const result = data[0];
  const tier: Tier = (result.tier as Tier) || "free";
  return {
    tier,
    used: result.used || 0,
    limit: LIMITS[tier][usageType],
  };
}

/**
 * Get next midnight UTC for rate limit reset
 */
function getNextMidnightUTC(): string {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * Get current usage for a user
 */
async function getCurrentUsage(
  userId: string,
  usageType: UsageType
): Promise<number> {
  const admin = getAdminClient();
  const today = new Date().toISOString().split("T")[0];

  const { data } = await admin
    .from("usage_daily")
    .select(usageType)
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  return data?.[usageType] ?? 0;
}

/**
 * Increment usage for a user
 */
async function incrementUsage(
  userId: string,
  usageType: UsageType,
  amount: number
): Promise<void> {
  amount = Math.round(amount);
  const admin = getAdminClient();
  const today = new Date().toISOString().split("T")[0];

  // Upsert to create row if doesn't exist
  const { data: existing } = await admin
    .from("usage_daily")
    .select("id, " + usageType)
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  if (existing) {
    await admin
      .from("usage_daily")
      .update({ [usageType]: (existing[usageType] ?? 0) + amount })
      .eq("id", existing.id);
  } else {
    await admin.from("usage_daily").insert({
      user_id: userId,
      date: today,
      [usageType]: amount,
    });
  }
}

/**
 * Check if transcription is allowed (seconds-based)
 * Call BEFORE starting transcription
 */
export async function checkTranscriptionUsage(
  userId: string,
  durationSeconds: number
): Promise<UsageResult> {
  const tier = await getUserTier(userId);
  const limit = LIMITS[tier].transcribe_seconds;
  const used = await getCurrentUsage(userId, "transcribe_seconds");

  if (used + durationSeconds > limit) {
    return { allowed: false, used, limit };
  }

  return { allowed: true, used, limit };
}

/**
 * Record transcription usage (seconds)
 * Call AFTER successful transcription
 */
export async function recordTranscriptionUsage(
  userId: string,
  durationSeconds: number
): Promise<void> {
  await incrementUsage(userId, "transcribe_seconds", durationSeconds);
}

/**
 * Check evaluation usage without incrementing
 * Call BEFORE starting evaluation to pre-check quota
 */
export async function checkEvaluateUsage(
  userId: string
): Promise<UsageResult> {
  const tier = await getUserTier(userId);
  const limit = LIMITS[tier].evaluate_count;
  const used = await getCurrentUsage(userId, "evaluate_count");

  if (used >= limit) {
    return { allowed: false, used, limit };
  }

  return { allowed: true, used, limit };
}

/**
 * Record evaluation usage
 * Call AFTER successful evaluation
 */
export async function recordEvaluateUsage(userId: string): Promise<void> {
  await incrementUsage(userId, "evaluate_count", 1);
}

/**
 * Check and increment evaluation usage (legacy - kept for compatibility)
 */
export async function checkAndIncrementEvaluateUsage(
  userId: string
): Promise<UsageResult> {
  const tier = await getUserTier(userId);
  const limit = LIMITS[tier].evaluate_count;
  const used = await getCurrentUsage(userId, "evaluate_count");

  if (used >= limit) {
    return { allowed: false, used, limit };
  }

  await incrementUsage(userId, "evaluate_count", 1);
  return { allowed: true, used: used + 1, limit };
}

/**
 * Check and increment bible fetch usage
 */
export async function checkAndIncrementBibleUsage(
  userId: string
): Promise<UsageResult> {
  const tier = await getUserTier(userId);
  const limit = LIMITS[tier].bible_fetch_count;
  const used = await getCurrentUsage(userId, "bible_fetch_count");

  if (used >= limit) {
    return { allowed: false, used, limit };
  }

  await incrementUsage(userId, "bible_fetch_count", 1);
  return { allowed: true, used: used + 1, limit };
}

/**
 * Create rate limit response
 */
export function rateLimitResponse(used: number, limit: number): Response {
  return rateLimited(used, limit, getNextMidnightUTC());
}
