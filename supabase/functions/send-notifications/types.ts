/**
 * Shared types for the send-notifications edge function.
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
