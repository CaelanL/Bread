# Auth

Auth is Supabase Auth. Users sign in with email and password. A
Google method and an anonymous fallback exist in code, but no screen
offers them. Sessions persist across app restarts via AsyncStorage
(Supabase manages this transparently).

## Files

| File | Role |
|---|---|
| `lib/api/client.ts` | Supabase client setup (anon key, AsyncStorage on native), `ensureAuth`, `getAuthToken` |
| `lib/auth/context.tsx` | `AuthProvider` + `useAuth()` hook — exposes session state and sign-in/up methods, handles auth deep links |
| `lib/auth/index.ts` | Re-exports |
| `lib/auth/dev-sign-in.ts` | `canDevSignIn` guard for the dev route |
| `app/_layout.tsx` | Auth gating — see `docs/architecture/navigation-and-routing.md` |
| `app/(auth)/sign-in.tsx` | Email/password sign-in, links to sign-up and forgot password |
| `app/(auth)/sign-up.tsx` | Email/password sign-up |
| `app/(auth)/forgot-password.tsx` | Send password-reset email |
| `app/reset-password.tsx` | Set new password (entered via deep link from email) |
| `app/dev-sign-in.tsx` | Dev-only sign-in as a seed user |

## Flows

### Email / password sign-up

```
User enters email + password on /(auth)/sign-up (8 characters minimum)
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

`signInWithGoogle()` is on the context and calls
`supabase.auth.signInWithOAuth` with `redirectTo: 'com.biblemem://'`,
but no screen calls it. On native that call only returns a URL, and
nothing opens it, so offering Google needs a browser step as well as
a button. `handleDeepLink` would take the tokens from the callback.

### Password reset

```
User taps "Forgot password?" → /(auth)/forgot-password
  → resetPassword(email) → supabase.auth.resetPasswordForEmail(email, {
       redirectTo: 'com.biblemem://reset-password/' })
  → Supabase emails recovery link
User taps email link
  → deep link com.biblemem://reset-password#access_token=...&refresh_token=...&type=recovery
  → handleDeepLink (AuthProvider) calls supabase.auth.setSession(...)
  → type=recovery: router.replace('/reset-password')
  → updatePassword(newPassword) → supabase.auth.updateUser({ password })
  → user signed in with new password, redirected to /(tabs)
```

The link must be opened on a device with the app installed. Signed-in
users can also change their password from Settings, which calls
`updatePassword` too.

### Anonymous sign-in

`ensureAuth()` in `lib/api/client.ts` calls
`supabase.auth.signInAnonymously()` if no session exists. No screen
offers it. It's a fallback inside store, storage and sync helpers
that call `ensureAuth()` first, and the auth gate keeps those screens
behind a session, so a real user shouldn't end up anonymous.

If one did, `AuthProvider` treats any session as authenticated for
routing. An anonymous session is a real user row in `auth.users`.

### Account deletion

```
User confirms in Settings (Alert, then types DELETE)
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

Curated save totals follow the [anonymous retention rule](../features/home.md#community-saves).

### Sign out

```
signOut() → unregisterDeviceToken() — this device's push token row
  deleted while still signed in (docs/features/notifications.md)
  → supabase.auth.signOut()
  → AsyncStorage tokens removed
  → AuthProvider session cleared, isAuthenticated goes false
  → effect in app/_layout.tsx:
      useAppStore.getState().clear() — Zustand user data wiped
      (device prefs survive, see docs/architecture/sync-and-storage.md)
      usePrefsStore.getState().clear() — local notification cache wiped
  → Auth gating redirects to /(auth)/sign-in
```

### Dev sign-in

`app/dev-sign-in.tsx` signs in as a seed user from `supabase/seed.sql`,
then opens a route, so `npm run sim` can reach signed-in screens
without taps:
`com.biblemem://dev-sign-in?next=/settings&as=reader-b`.

`canDevSignIn` guards it: the build must be a dev build (`__DEV__`)
and `EXPO_PUBLIC_SUPABASE_URL` must point at `127.0.0.1` or
`localhost`. Otherwise the route just goes home. The auth gate lets
this route through without a session, like `reset-password`.

## Auth gating

`app/_layout.tsx` redirects by auth state. The code and its states
are in `docs/architecture/navigation-and-routing.md`.

## Session persistence

`lib/api/client.ts` configures the Supabase client:

```ts
const storage = Platform.OS === "web" ? undefined : AsyncStorage;
createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,                      // undefined means localStorage on web
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,    // we handle deep links ourselves
  },
});
```

- Tokens live in AsyncStorage (`sb-<project>-auth-token`).
- Refresh token is used automatically before access token expires.
- On app boot, `supabase.auth.getSession()` rehydrates the session
  from AsyncStorage — no network call needed.

## Deep links

`handleDeepLink` in `AuthProvider` (`lib/auth/context.tsx`) reads both
the initial URL and later URLs through `expo-linking`, turns the `#`
fragment into query params, and calls `supabase.auth.setSession(...)`
when it finds tokens. The link table is in
`docs/architecture/navigation-and-routing.md`.

## Where the user ID is read

Components use `useAuth().user`. Code in `lib/` reads it from
Supabase:

```ts
const { data: { user } } = await supabase.auth.getUser();
```

`lib/store/index.ts`, `lib/storage/index.ts` and `lib/sync/` call
`ensureAuth()` first (`getCurrentUserId` in each). `lib/api/analytics.ts`
and `lib/notifications/api.ts` don't. RLS on every user-owned table
enforces `auth.uid() = user_id`, so even if a mistake bypasses the
check, the database refuses the write.

## Invariants

1. **Auth calls go through `lib/auth/context.tsx`.** Components
   call `useAuth().signIn(...)` etc., not `supabase.auth.*`
   directly. The context owns session state and onAuthStateChange.
2. **The `service_role` key never ships to the client.** See
   `docs/architecture/edge-functions.md`.
3. **`reset-password` route must remain accessible without auth.**
   Don't add it to the auth gate's "redirect if not authed" list.
4. **`useAppStore.clear()` must run on sign-out.** Otherwise
   the next user signing in inherits the previous user's
   collections/verses in memory until hydration completes.
5. **Device prefs survive sign-out by design.** `colorMode`, for
   one, is a device preference, not a user preference. Don't include
   them in `clear()`.
6. **`canDevSignIn` stays the only way into dev sign-in.** Don't
   loosen its dev-build or local-URL checks.

## Sharp edges

- **Anonymous sessions can orphan data.** If a user ever got an
  anonymous session and then signed up with email, the two
  `auth.users` rows are unrelated — the anon user's data doesn't
  migrate.
- **Bible version is not synced to Supabase.** Sign in on a new
  device, you get ESV until you change it. Documented in
  `docs/architecture/bible-versions.md`.
- **No `signed-in-on-multiple-devices` invalidation.** Standard
  Supabase Auth — refresh tokens are per-session.
- **Password lengths differ.** Sign-up and reset ask for 8 characters,
  Settings asks for 6.

## Browser checks

- `npm run sim -- flow sign-in-out`: reader-b signs in through the form, Settings shows
  `reader-b@example.test`, Sign Out returns to the Sign In screen.
