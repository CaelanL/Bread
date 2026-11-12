// lib-ok: pure guard for app/dev-sign-in.tsx, apart so a unit test can load it without React Native

export const DEV_SIGN_IN_PASSWORD = 'password123';

/** Only a dev build talking to a local Supabase (this machine, or its LAN address for a phone) may sign in as a seed user. */
export function canDevSignIn(isDev: boolean, supabaseUrl: string | undefined): boolean {
  return isDev && /^http:\/\/(127\.0\.0\.1|localhost|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?(\/|$)/.test(supabaseUrl ?? '');
}
