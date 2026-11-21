import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { getAdminClient, verifyJwt } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { badRequest, rateLimited, serverError, unauthorized } from "../_shared/errors.ts";

// A handoff carries an invite across a fresh install, matched by network (a keyed hash of the
// caller's IP): the sendlabs.dev join page `record`s, and Bread on its first sign-in `claim`s.
// A wrong match only shows a join modal the person can close. See
// docs/architecture/navigation-and-routing.md#invite-handoff.
const TTL_MS = 60 * 60 * 1000;
const CODE = /^[A-Z0-9]{8}$/;
// Records per network per TTL window: a household's few invites, not a flood.
const MAX_RECORDS = 5;

// The platform gateway appends the address it saw to x-forwarded-for, so the last hop is the one
// a caller can't forge (earlier hops are whatever the caller sent). The connection's own address
// is the local fallback. Verify once after each deploy (docs/architecture/edge-functions.md).
function callerIp(req: Request, remote: Deno.Addr): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  return forwarded || req.headers.get("x-real-ip") || ("hostname" in remote ? remote.hostname : null);
}

// HMAC with the HANDOFF_SALT secret, so a stored key can't be reversed by hashing every IPv4
// address. Without the secret (local, or before it's set) it falls back to a plain hash, which
// still matches record to claim.
const salt = Deno.env.get("HANDOFF_SALT");
if (!salt) console.warn("[HANDOFF] HANDOFF_SALT is not set; network keys are unkeyed hashes");
const hmacKey = salt
  ? crypto.subtle.importKey("raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  : null;

async function networkKey(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`bread-handoff:${ip}`);
  const digest = hmacKey
    ? await crypto.subtle.sign("HMAC", await hmacKey, data)
    : await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req, info) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;
  if (req.method !== "POST") return badRequest("Method not allowed");

  const body = await req.json().catch(() => null) as { action?: string; code?: string } | null;
  const ip = callerIp(req, info.remoteAddr);
  if (!body || !ip) return badRequest("Bad request");
  const network = await networkKey(ip);
  const db = getAdminClient();
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();

  try {
    if (body.action === "record") {
      const code = String(body.code ?? "").toUpperCase();
      if (!CODE.test(code)) return badRequest("Bad code");
      await db.from("invite_handoffs").delete().lt("created_at", cutoff);
      const { data: recent, error: countError } = await db.from("invite_handoffs")
        .select("code").eq("network", network).gte("created_at", cutoff);
      if (countError) throw countError;
      if (recent.length >= MAX_RECORDS && !recent.some((row) => row.code === code)) {
        return rateLimited(recent.length, MAX_RECORDS, new Date(Date.now() + TTL_MS).toISOString());
      }
      const { error } = await db.from("invite_handoffs")
        .upsert({ network, code, created_at: new Date().toISOString() }, { onConflict: "network,code" });
      if (error) throw error;
      return json({ ok: true });
    }

    if (body.action === "claim") {
      if (!(await verifyJwt(req))) return unauthorized();
      const { data, error } = await db.from("invite_handoffs")
        .select("id, code").eq("network", network).gte("created_at", cutoff)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      if (!data) return json({ code: null });
      await db.from("invite_handoffs").delete().eq("id", data.id);
      return json({ code: data.code });
    }

    return badRequest("Unknown action");
  } catch (error) {
    console.error("[HANDOFF] Error:", error);
    return serverError("Handoff failed");
  }
});
