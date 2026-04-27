# Auth

> **Status: Living document.** Update when an auth flow changes,
> a provider is added, or the session-storage mechanism changes.
> Read before touching `lib/auth/`, `app/(auth)/`,
> `app/reset-password.tsx`, or anything that calls
> `supabase.auth.*`.

Auth is Supabase Auth. The app supports anonymous sessions,
email/password, and Google OAuth. Sessions persist across app
restarts via AsyncStorage (Supabase manages this transparently).

## Files

| File | Role |
|---|---|
| `lib/api/client.ts` | Supabase client setup (anon key, AsyncStorage adapter, deep-link handler bootstrap) |
| `lib/auth/context.tsx` | `AuthProvider` + `useAuth()` hook — exposes session state, sign-in/up methods |
| `lib/auth/index.ts` | Re-exports |
| `app/_layout.tsx` | Auth gating — redirects unauth'd users to `/(auth)/sign-in`, redirects auth'd users away from `/(auth)/*` |
| `app/(auth)/sign-in.tsx` | Email/password sign-in + Google OAuth button |
| `app/(auth)/sign-up.tsx` | Email/password sign-up |
| `app/(auth)/forgot-password.tsx` | Send password-reset email |
| `app/reset-password.tsx` | Set new password (entered via deep link from email) |

## Flows

### Email / password sign-up

```
User enters email + password on /(auth)/sign-up
  → signUp(email, password) → supabase.auth.signUp(...)
  → if email confirmation enabled: confirmation email sent, session not active until confirmed
  → if disabled: session active immediately
  → Auth gating in app/_layout.tsx redirects to /(tabs)
```

### Email / password sign-in

```
User enters credentials on /(auth)/sign-in
  → signIn(email, password) → supabase.auth.signInWithPassword(...)
  → access + refresh tokens stored in AsyncStorage by Supabase client
  → onAuthStateChange fires → AuthProvider updates session state
  → Auth gating redirects to /(tabs)
```

### Google OAuth

```
User taps "Continue with Google" on /(auth)/sign-in
  → signInWithGoogle() → supabase.auth.signInWithOAuth({
       provider: 'google',
       options: { redirectTo: 'com.biblemem://' }
     })
  → external browser opens Google consent
  → Google redirects to com.biblemem:// with tokens in URL fragment
  → expo-linking deep-link handler in lib/api/client.ts catches the URL
  → setSession(accessToken, refreshToken) called
  → onAuthStateChange fires → AuthProvider updates → user lands on /(tabs)
```

### Password reset

```
User taps "Forgot password" → /(auth)/forgot-password
  → resetPassword(email) → supabase.auth.resetPasswordForEmail(email, { redirectTo })
  → Supabase emails recovery link
User taps email link
  → deep link com.biblemem://reset-password?type=recovery&access_token=...
  → app/reset-password is reachable WITHOUT auth (auth gating allows it explicitly)
  → updatePassword(newPassword) → supabase.auth.updateUser({ password })
  → user signed in with new password, redirected to /(tabs)
```

### Anonymous sign-in

`ensureAuth()` in `lib/api/client.ts:31-44` calls
`supabase.auth.signInAnonymously()` if no session exists. This is
how the app can talk to Supabase before the user has an account —
it gets a UUID immediately, no email required.

In practice the `AuthProvider` listens for any auth state change
and treats the resulting session as "authenticated" for routing
purposes. An anonymous session is a real user row in `auth.users`.

> **Open question for the human**: is anonymous sign-in actually
> exposed in the UI, or is it a fallback for unauthenticated API
> calls only? The function exists; not clear whether a real user
> ever ends up anonymous. Worth confirming.

### Account deletion

```
User confirms delete in Settings
  → deleteAccount() → supabase.rpc('delete_own_account')
  → SQL function deletes in safe order:
      verse_collections → user_verses → user_collections
      → session_attempts → user_stats → auth.users (CASCADE handles the rest)
  → signOut() → session cleared
  → user redirected to /(auth)/sign-in
```

The function is `SECURITY DEFINER` so it can touch `auth.users`. It
only deletes the calling user — there's no parameter to delete
someone else.

### Sign out

```
signOut() → supabase.auth.signOut()
  → AsyncStorage tokens removed
  → AuthProvider session cleared
  → useAppStore.getState().clear() — Zustand state wiped
    EXCEPT colorMode (theme preference persists across logout)
  → Auth gating redirects to /(auth)/sign-in
```

## Auth gating

In `app/_layout.tsx`:

```tsx
useEffect(() => {
  if (!navigationState?.key || isLoading) return;
  const inAuthGroup = segments[0] === '(auth)';
  const isResetPassword = segments[0] === 'reset-password';

  if (!isAuthenticated && !inAuthGroup && !isResetPassword) {
    router.replace('/(auth)/sign-in');
  } else if (isAuthenticated && inAuthGroup) {
    router.replace('/(tabs)');
  }
}, [isAuthenticated, isLoading, segments, navigationState?.key]);
```

Three states:

- Not authenticated, in `(auth)` or `reset-password`: stay put.
- Not authenticated, anywhere else: redirect to sign-in.
- Authenticated, in `(auth)`: redirect to `/(tabs)`.

`reset-password` is whitelisted because the user clicks the email
link without a session.

## Session persistence

`lib/api/client.ts` configures the Supabase client:

```ts
const supabase = createClient(URL, ANON_KEY, {
  auth: {
    storage: AsyncStorage,        // RN; localStorage on web
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,    // we handle deep links ourselves
  },
});
```

- Tokens live in AsyncStorage (`sb-<project>-auth-token`).
- Refresh token is used automatically before access token expires.
- On app boot, `supabase.auth.getSession()` rehydrates the session
  from AsyncStorage — no network call needed.

## Deep links

The app's URL scheme is `com.biblemem://` (configured in
`app.config.js`). Deep links handle:

- OAuth callback (Google) — token fragment in URL
- Password reset (`com.biblemem://reset-password?...`)

The handler in `lib/api/client.ts` listens for deep links via
`expo-linking`, extracts auth params, and calls
`supabase.auth.setSession(...)`.

## Where the user ID is read

```ts
import { ensureAuth } from '@/lib/api/client';
const userId = (await ensureAuth()).id;
```

`ensureAuth()` returns the current user (creating an anonymous
session if needed). All authenticated calls use this. RLS on every
user-owned table enforces `auth.uid() = user_id`, so even if a
mistake bypasses the check, the database refuses the write.

## Invariants

1. **Auth calls go through `lib/auth/context.tsx`.** Components
   call `useAuth().signIn(...)` etc., not `supabase.auth.*`
   directly. The context owns session state and onAuthStateChange.
2. **Use `ensureAuth()` to get the user ID.** Don't read
   `supabase.auth.getUser()` ad-hoc — `ensureAuth` handles the
   anonymous fallback and is consistent across the codebase.
3. **The `service_role` key never ships to the client.** The app
   uses the anon key. Service role is edge-functions-only.
4. **`reset-password` route must remain accessible without auth.**
   Don't add it to the auth gate's "redirect if not authed" list.
5. **`useAppStore.clear()` must be called on sign-out.** Otherwise
   the next user signing in inherits the previous user's
   collections/verses in memory until hydration completes.
6. **`colorMode` survives sign-out by design.** It's a device
   preference, not a user preference. Don't include it in
   `clear()`.

## Sharp edges

- **Anonymous sessions can accumulate orphaned data.** If a user
  uses the app anonymously, then signs up with email, the two
  `auth.users` rows are unrelated — the anon user's data doesn't
  migrate. (May or may not be relevant depending on whether
  anonymous is exposed in the UI.)
- **Bible version is not synced to Supabase.** Sign in on a new
  device, you get ESV until you change it. Documented in
  `docs/architecture/bible-versions.md`.
- **No `signed-in-on-multiple-devices` invalidation.** Standard
  Supabase Auth — refresh tokens are per-session.
- **Leaked-password-protection is disabled.** Tracked in
  `docs/operations/security-todo.md`.
