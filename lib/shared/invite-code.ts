// lib-ok: Invite code, link, message and install-handoff rules, plus the share and join error text; pure, so unit-tested.
import type { SharedRole } from '@/lib/storage';

export const INVITE_CODE_LENGTH = 8;

export function isSharedRole(value: unknown): value is SharedRole {
  return value === 'owner' || value === 'editor' || value === 'member';
}

/** What the server accepts: upper case, spaces, dashes and anything else dropped. */
export function normalizeInviteCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, INVITE_CODE_LENGTH);
}

/**
 * A web link every chat app makes tappable. With Bread installed iOS opens the app on it (the
 * applinks claim in app.config.js, verified by sendlabs.dev's apple-app-site-association);
 * without Bread it's sendlabs.dev's join page, with the App Store link and the code.
 */
export function inviteLink(code: string): string {
  return `https://sendlabs.dev/bread/join/${code}`;
}

export function inviteMessage(collectionName: string, code: string): string {
  return `Join "${collectionName}" with me on Bread: ${inviteLink(code)}\n\nOr in Bread, tap + → Join with code: ${code}`;
}

/** An opened sendlabs.dev invite link as Bread's own join route; any other path unchanged. */
export function joinRouteFromLink(path: string): string {
  const code = path.match(/^(?:https?:\/\/(?:www\.)?sendlabs\.dev)?\/bread\/join\/([^/?#]+)/i)?.[1];
  if (!code) return path;
  try {
    return `/join/${normalizeInviteCode(decodeURIComponent(code))}`;
  } catch {
    // Bad percent-encoding: leave the path as it came, so routing shows not-found instead of crashing.
    return path;
  }
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

/**
 * What this launch does about a handoff: nothing once the install has checked; mark it checked
 * without asking when the session was restored at launch (an existing install updating to this
 * version isn't the phone that just installed from the invite, and asking could eat a friend's
 * row on the same Wi-Fi); otherwise claim.
 */
export function handoffStep(checked: boolean, sessionRestored: boolean): 'skip' | 'mark' | 'claim' {
  if (checked) return 'skip';
  return sessionRestored ? 'mark' : 'claim';
}
