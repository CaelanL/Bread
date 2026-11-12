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

export function inviteLink(code: string): string {
  return `com.biblemem://join/${code}`;
}

// Messages and most chat apps don't make custom-scheme links tappable, so the code is in plain words too.
export function inviteMessage(collectionName: string, code: string): string {
  return `Join "${collectionName}" on Bread: ${inviteLink(code)} — or enter code ${code} in Bread`;
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
