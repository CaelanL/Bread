// lib-ok: decides what a settled session restore means for a painted snapshot; pure, so it's tested
import { isAuthRetryableFetchError } from '@supabase/supabase-js';

/** supabase-js's default key for the stored session, set explicitly so it can be read before the client settles. */
export function authStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/**
 * What a launch's `getSession()` means once it settles, for the user whose saved library may already
 * be painted (`storedUserId`, from the stored session): a session → start it; a refresh that
 * couldn't reach the server → stay on the saved library (supabase-js keeps the session and retries,
 * and its TOKEN_REFRESHED starts the account); anything else → signed out.
 */
export function afterRestore(
  storedUserId: string | null,
  result: { session: { user: { id: string } } | null; error: unknown },
): 'continue' | 'offline' | 'signed-out' {
  if (result.session) return 'continue';
  if (storedUserId && isAuthRetryableFetchError(result.error)) return 'offline';
  return 'signed-out';
}
