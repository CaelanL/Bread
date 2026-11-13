// lib-ok: Invite code, link and message rules, plus the share and join error text; pure, so unit-tested.
import type { SharedRole } from '@/lib/storage';

export const INVITE_CODE_LENGTH = 8;

export function isSharedRole(value: unknown): value is SharedRole {
  return value === 'owner' || value === 'editor' || value === 'member';
}

/** What the server accepts: upper case, spaces, dashes and anything else dropped. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, INVITE_CODE_LENGTH);
}

export const APP_STORE_URL = 'https://apps.apple.com/app/id6757946016';

// Most people invited don't have Bread yet, and chat apps don't make com.biblemem:// links
// tappable, so the message carries the App Store link and the code to type once installed.
export function inviteMessage(collectionName: string, code: string): string {
  return `Join "${collectionName}" with me on Bread, a Bible memory app.\n\n`
    + `Get Bread: ${APP_STORE_URL}\nThen tap + → Join with code and enter ${code}`;
}

export function daysLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}

const INVITE_MESSAGES: Record<string, string> = {
  'Invite expired': 'This invite has expired. Ask for a new link.',
  'Invite not found': "This code doesn't match an invite. Check it, or ask for a new link.",
};

/** The text for a failed shared-collection call: the server's 22023 message as is, else the fallback. */
export function sharedErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== 'object' || error === null) return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== '22023' || typeof message !== 'string') return fallback;
  return INVITE_MESSAGES[message] ?? message;
}
