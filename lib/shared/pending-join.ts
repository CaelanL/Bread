// lib-ok: Holds an invite code from a signed-out link tap through sign-in, sign-up with email confirmation and an app kill, and claims one carried across a fresh install.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/api/client';

import { normalizeInviteCode } from './invite-code';

const PENDING_JOIN_KEY = 'shared_pending_join';
const HANDOFF_CHECKED_KEY = 'shared_handoff_checked';

export async function stashPendingJoin(code: string) {
  await AsyncStorage.setItem(PENDING_JOIN_KEY, code);
}

export async function readPendingJoin(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_JOIN_KEY);
}

export async function clearPendingJoin() {
  await AsyncStorage.removeItem(PENDING_JOIN_KEY);
}

/**
 * Once per install, after the first sign-in: an invite the sendlabs.dev join page recorded for this
 * network in the last hour, so someone who installed from an invite lands on it. A failed call
 * asks again next launch; the server keeps a handoff only an hour. See
 * docs/architecture/navigation-and-routing.md#invite-handoff.
 *
 * The claim deletes the server's row, so a caller cancelled mid-flight (the pending-invite effect
 * re-runs as sign-in settles) must not lose it: every caller shares the one in-flight claim until
 * `forgetInstallHandoff` marks its code as opened.
 */
let handoff: Promise<string | null> | null = null;

export function claimInstallHandoff(): Promise<string | null> {
  handoff ??= claimOnce();
  return handoff;
}

export function forgetInstallHandoff() {
  handoff = Promise.resolve(null);
}

async function claimOnce(): Promise<string | null> {
  if (await AsyncStorage.getItem(HANDOFF_CHECKED_KEY)) return null;
  const { data, error } = await supabase.functions.invoke<{ code: string | null }>('invite-handoff', {
    body: { action: 'claim' },
  });
  if (error) {
    handoff = null;
    return null;
  }
  await AsyncStorage.setItem(HANDOFF_CHECKED_KEY, '1');
  return typeof data?.code === 'string' ? normalizeInviteCode(data.code) || null : null;
}
