// lib-ok: The "What's new in Bread" 2.0 walkthrough's once-per-account claim, a Supabase write (invariant 1).
import { supabase } from '@/lib/api/client';

const claims = new Map<string, Promise<boolean>>();

/**
 * Whether this account should see the walkthrough now. The first call for an account marks it seen
 * on the server, only while it's unseen, and answers true only if the row came back. So it shows on
 * one device, once: a second device, a relaunch or a new account gets false, and a failed write
 * shows nothing until a later launch. Calls in the same run share the first answer.
 */
export function claimWelcome(userId: string): Promise<boolean> {
  let claim = claims.get(userId);
  if (!claim) {
    claim = Promise.resolve(
      supabase.from('profiles')
        .update({ welcome_v2_seen_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('welcome_v2_seen_at', null)
        .select('user_id'),
    ).then(({ data, error }) => {
      if (error) throw error;
      return data.length === 1;
    }).catch((e) => {
      console.error('[welcome] Failed to claim the walkthrough:', e);
      return false;
    });
    claims.set(userId, claim);
  }
  return claim;
}

/** Call as the walkthrough opens, so a later claim in this run answers false. */
export function markWelcomeShown(userId: string) {
  claims.set(userId, Promise.resolve(false));
}
