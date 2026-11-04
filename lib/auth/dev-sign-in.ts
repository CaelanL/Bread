// lib-ok: pure guard for app/dev-sign-in.tsx, apart so a unit test can load it without React Native

export const DEV_SIGN_IN_PASSWORD = 'password123';

/** Only a dev build talking to a Supabase on this machine may sign in as a seed user. */
export function canDevSignIn(isDev: boolean, supabaseUrl: string | undefined): boolean {
  return isDev && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(supabaseUrl ?? '');
}
