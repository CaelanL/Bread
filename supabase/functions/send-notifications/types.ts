/**
 * Shared types for the send-notifications edge function.
 *
 * Chunk 1 keeps this minimal — the only consumer is the auth
 * skeleton. Sources land in chunk 2 and will extend this with body
 * composition + Expo Push payload shapes.
 */

export type NotificationSource = "reviews" | "in-progress";

export type NotificationStatus =
  | "sent"
  | "skipped-empty"
  | "token-error"
  | "send-error";

export interface NotificationLogRow {
  user_id: string;
  source: NotificationSource;
  status: NotificationStatus;
  body?: string | null;
  expo_ticket?: string | null;
  error?: string | null;
}
