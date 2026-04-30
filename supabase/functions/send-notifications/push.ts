/**
 * Expo Push Service client.
 *
 * Single point of contact with https://exp.host/--/api/v2/push/send.
 * Sources call sendPush() with a composed message; this module
 * handles the HTTP, parses the ticket, and routes ticket-level errors
 * back to the caller as discriminated `PushOutcome` results.
 *
 * Receipts (the second-stage delivery confirmation from APNs/FCM)
 * are intentionally NOT polled in v1. See
 * docs/features/notification-system.md "What this feature explicitly
 * will NOT add" — at Bread's scale, dead-token cruft is rounding
 * error. The `expo_ticket` column on notification_log is populated
 * here so a future receipts cron is purely additive.
 *
 * Authentication: Push Security is enabled on the Expo project. The
 * EXPO_ACCESS_TOKEN env var must be set on the function. Without it,
 * Expo returns UNAUTHORIZED on every send.
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  priority?: "default" | "normal" | "high";
  channelId?: string;
}

export type PushOutcome =
  | { status: "sent"; ticketId: string }
  | { status: "token-error"; error: string }   // delete the token row
  | { status: "send-error"; error: string };   // log + skip; non-token failures

interface TicketOk {
  status: "ok";
  id: string;
}
interface TicketErr {
  status: "error";
  message: string;
  details?: { error?: string };
}
type Ticket = TicketOk | TicketErr;

/**
 * Send a single push. Returns a discriminated outcome the caller
 * uses to decide whether to delete the token row.
 *
 * Errors are categorized:
 *  - DeviceNotRegistered → token-error (caller deletes token)
 *  - InvalidCredentials, MismatchSenderId, MessageTooBig, etc.
 *    → send-error (log + continue)
 *  - Network / 5xx → send-error (one bad pass; cron retries next minute)
 */
export async function sendPush(msg: PushMessage): Promise<PushOutcome> {
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (!accessToken) {
    return {
      status: "send-error",
      error: "EXPO_ACCESS_TOKEN env var not set on function",
    };
  }

  let response: Response;
  try {
    response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        host: "exp.host",
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        sound: "default",
        priority: "high",
        ...msg,
      }),
    });
  } catch (err) {
    return {
      status: "send-error",
      error: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "<no body>");
    return {
      status: "send-error",
      error: `Expo HTTP ${response.status}: ${text.slice(0, 200)}`,
    };
  }

  let payload: { data?: Ticket | Ticket[]; errors?: { code: string; message: string }[] };
  try {
    payload = await response.json();
  } catch (err) {
    return {
      status: "send-error",
      error: `failed to parse Expo response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (payload.errors?.length) {
    const e = payload.errors[0];
    return { status: "send-error", error: `${e.code}: ${e.message}` };
  }

  // `data` may be a single ticket (we send one message per call) or an
  // array. Normalize to single.
  const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!ticket) {
    return { status: "send-error", error: "Expo returned no ticket" };
  }

  if (ticket.status === "ok") {
    return { status: "sent", ticketId: ticket.id };
  }

  // ticket.status === "error"
  const errCode = ticket.details?.error ?? "unknown";
  if (errCode === "DeviceNotRegistered") {
    return { status: "token-error", error: errCode };
  }
  return { status: "send-error", error: `${errCode}: ${ticket.message}` };
}
