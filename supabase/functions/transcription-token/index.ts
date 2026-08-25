import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyJwt } from "../_shared/auth.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { badRequest, serverError, unauthorized } from "../_shared/errors.ts";

const SONIOX_API_KEY = Deno.env.get("SONIOX_API_KEY");

// Temp key gates connection establishment only; the session may continue
// past expiry up to max_session_duration_seconds.
const KEY_TTL_SECONDS = 60;
// Client-side cap is 300s (MAX_RECORDING_MS); 315 keeps the client timer
// firing first so streams finalize cleanly instead of being cut by Soniox.
const MAX_SESSION_SECONDS = 315;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return badRequest("Method not allowed");
  }

  const user = await verifyJwt(req);
  if (!user) {
    return unauthorized();
  }

  // Kill switch: when unset/false every client silently falls back to
  // the batch path. Flip with `supabase secrets set` — no deploy needed.
  if (Deno.env.get("LIVE_TRANSCRIPTION_ENABLED") !== "true") {
    return new Response(JSON.stringify({ error: "LIVE_DISABLED" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SONIOX_API_KEY) {
    console.error("[TOKEN] SONIOX_API_KEY not configured");
    return serverError("Transcription not configured");
  }

  try {
    const mintRes = await fetch(
      "https://api.soniox.com/v1/auth/temporary-api-key",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SONIOX_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          usage_type: "transcribe_websocket",
          expires_in_seconds: KEY_TTL_SECONDS,
          max_session_duration_seconds: MAX_SESSION_SECONDS,
          client_reference_id: user.id,
        }),
      },
    );

    if (!mintRes.ok) {
      console.error(
        `[TOKEN] Mint failed: ${mintRes.status} ${await mintRes.text()}`,
      );
      return serverError("Failed to mint transcription key");
    }

    const minted = await mintRes.json();
    console.log(`[TOKEN] Minted for user ${user.id.slice(0, 8)}...`);

    return new Response(
      JSON.stringify({
        apiKey: minted.api_key,
        expiresAt: minted.expires_at ?? null,
        websocketUrl: "wss://stt-rt.soniox.com/transcribe-websocket",
        model: "stt-rt-v5",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[TOKEN] Error:", error);
    return serverError("Failed to mint transcription key");
  }
});
