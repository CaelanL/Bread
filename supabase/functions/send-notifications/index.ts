/**
 * send-notifications edge function
 *
 * Invoked by pg_cron every minute. Authenticates a cron-secret
 * bearer (constant-time compare against the Vault-stored secret),
 * then dispatches to each notification source.
 *
 * CHUNK 1 SCAFFOLD: this file currently only handles auth. Source
 * dispatch (reviews-digest, in-progress) lands in chunk 2. Isolating
 * the auth model proves the load-bearing piece — Vault read,
 * constant-time compare, gateway bypass — before any source logic
 * exists to muddy the diagnosis.
 *
 * See:
 *   - docs/features/notification-system.md (design)
 *   - docs/features/notification-system-build-plan.md (chunked rollout)
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { getAdminClient } from "../_shared/auth.ts";
import { unauthorized, jsonResponse, serverError } from "../_shared/errors.ts";

/**
 * Constant-time string compare. The function is publicly reachable
 * (verify_jwt = false), so a `===` compare leaks bits via timing.
 * We compare ASCII-encoded bytes to keep the work uniform.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Read cron_secret via the public.get_cron_secret() SECURITY DEFINER
 * RPC (defined in migration 018). We can't query vault.decrypted_secrets
 * directly: PostgREST enforces a schema allowlist that service_role
 * doesn't bypass, AND service_role has no SELECT on the view by default.
 * The RPC is the canonical Supabase pattern.
 *
 * Cached per warm container; refresh-on-mismatch handles rotation
 * (see authenticateCron). Bypassing the cache means one failed compare
 * triggers a fresh Vault read before returning 401.
 */
let cachedSecret: string | null = null;
async function getCronSecret(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedSecret) return cachedSecret;
  const admin = getAdminClient();
  const { data, error } = await admin.rpc("get_cron_secret");
  if (error || !data) {
    console.error("[notifications] failed to read cron_secret via RPC", error);
    return null;
  }
  cachedSecret = data as string;
  return cachedSecret;
}

/**
 * Auth gate. Returns null if authenticated, an error Response otherwise.
 *
 * Refresh-on-mismatch: if the cached secret doesn't match, we re-read
 * Vault once before returning 401. This handles secret rotation
 * without requiring a full container recycle — without it, warm
 * containers could 401 dozens of cron passes after rotation.
 */
async function authenticateCron(req: Request): Promise<Response | null> {
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!provided) return unauthorized();

  let expected = await getCronSecret();
  if (expected && timingSafeEqual(expected, provided)) return null;

  // Mismatch — refresh once in case the secret was rotated.
  expected = await getCronSecret(true);
  if (expected && timingSafeEqual(expected, provided)) return null;

  return unauthorized();
}

serve(async (req) => {
  try {
    const authError = await authenticateCron(req);
    if (authError) return authError;

    // Chunk 1: auth-only skeleton. Log the pass to the function's
    // stdout (visible in the Supabase Functions Logs dashboard);
    // source dispatch lands in chunk 2.
    console.log("[notifications] cron pass authenticated");

    return jsonResponse({ ok: true, dispatched: 0 });
  } catch (err) {
    console.error("[notifications] unhandled error", err);
    return serverError("Internal error");
  }
});
