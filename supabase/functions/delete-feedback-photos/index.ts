/**
 * delete-feedback-photos edge function
 *
 * Called daily by pg_cron with the cron-secret bearer. Removes feedback photos whose account
 * no longer exists, through the Storage API (SQL can't delete Storage files). Every account
 * delete path is covered, old clients included. docs/features/feedback.md.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { getAdminClient } from "../_shared/auth.ts";
import { jsonResponse, serverError, unauthorized } from "../_shared/errors.ts";

const BUCKET = "feedback-photos";
// orphaned_feedback_photos() returns at most 1000 names a call; this bounds one run.
const MAX_ROUNDS = 20;

// Constant time: the function is public (verify_jwt = false).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  try {
    const admin = getAdminClient();
    const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: secret } = await admin.rpc("get_cron_secret");
    if (!provided || typeof secret !== "string" || !timingSafeEqual(secret, provided)) {
      return unauthorized();
    }

    let removed = 0;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data: names, error } = await admin.rpc("orphaned_feedback_photos");
      if (error) throw error;
      if (!names?.length) break;
      const { data, error: removeError } = await admin.storage.from(BUCKET).remove(names);
      if (removeError) throw removeError;
      if (!data?.length) break; // nothing removable: don't spin on the same names
      removed += data.length;
    }
    if (removed > 0) console.log(`[feedback-photos] removed ${removed}`);
    return jsonResponse({ ok: true, removed });
  } catch (err) {
    console.error("[feedback-photos] failed", err);
    return serverError("Internal error");
  }
});
