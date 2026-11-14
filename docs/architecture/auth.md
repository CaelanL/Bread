# Auth

Auth is Supabase Auth. Users sign in with email and password. A
Google method exists in code, but no screen offers it. Nothing signs
in anonymously. Sessions persist across app restarts via AsyncStorage
(Supabase manages this transparently).

## Files

| File | Role |
|---|---|
| `lib/api/client.ts` | Supabase client setup (anon key, AsyncStorage on native), `sessionUserId`, `getAuthToken` |
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

A shared collection the user owns cascades away with `auth.users`, and every member
keeps their copy as a personal collection ([dissolve](../features/shared-collections.md#dissolve)).
Memberships in other people's groups cascade too.

Curated save totals follow the [anonymous retention rule](../features/home.md#community-saves).
Intro presentation markers cascade with the account; see [Home](../features/home.md#encouragement-video).

### Sign out

```
signOut() → unregisterDeviceToken() — this device's push token row
  deleted while still signed in (docs/features/notifications.md)
  → supabase.auth.signOut()
  → AsyncStorage tokens removed
  → AuthProvider session cleared, isAuthenticated goes false
  → SIGNED_OUT → setAccount(null) (lib/auth/account.ts):
      useAppStore.getState().clear() — Zustand user data wiped
      (device prefs survive, see docs/architecture/sync-and-storage.md)
      usePrefsStore.getState().clear() and that account's prefs cache removed
  → Auth gating redirects to /(auth)/sign-in
```

### Dev sign-in

`app/dev-sign-in.tsx` signs in as a seed user from `supabase/seed.sql`,
then opens a route, so `npm run sim` can reach signed-in screens
without taps:
`com.biblemem://dev-sign-in?next=/settings&as=reader-b`.

`latency=<ms>` and `perf=1` turn on the timing harness for this and later launches
(`lib/api/dev-timing.ts`, see sync-and-storage.md); every dev sign-in resets them.

`canDevSignIn` guards it: the build must be a dev build (`__DEV__`)
and `EXPO_PUBLIC_SUPABASE_URL` must point at `127.0.0.1` or
`localhost`. Otherwise the route just goes home. The auth gate lets
this route through without a session, like `reset-password`.

## Accounts start from the session

`AuthProvider` calls `setAccount(userId | null)` (`lib/auth/account.ts`) with the
`getSession()` result before it stops loading, and again on every `onAuthStateChange`.
So the library load starts when the stored session is read, before the tree mounts.

- Same id as now: nothing (`INITIAL_SESSION`, `TOKEN_REFRESHED`).
- A new id: if another account was active (a deep link or dev sign-in with no sign-out),
  clear the store and the prefs store first; their generation check drops the old
  account's late replies. Then `hydrate(userId)`, the UX flags, and the prefs
  (`hydrate(userId)`, then one `syncForegroundState`).
- `null`: clear both stores and remove the previous account's prefs cache. A launch with
  no session was never anyone, so it clears nothing.

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

## Display name

`profiles.first_name` (required once saved) and `profiles.last_name` (optional), 1 to 30
characters each, are the user's name. `profiles.display_name` is what members of a
[shared collection](../features/shared-collections.md) see: first name and last initial,
"Caelan L.", or the first name alone (`composeDisplayName` in `lib/shared/display-name.ts`).
Member circles show its initials, CL or C (`initials`).
`setName` in the store upserts all three together and rolls back with a toast, so every
reader of `display_name` stays as it was. Settings → Account → Name shows the full name, or
Add; its form (`NameFields`) starts empty, shows "Shown as Caelan L." as you type, and writes
nothing until Save. The share and join name step uses the same fields. A `display_name` saved
before first and last names became the first name.

## Where the user ID is read

Components use `useAuth().user`. Code in `lib/` calls `sessionUserId()`
(`lib/api/client.ts`), which reads the stored session: no network round
trip, and null when signed out, never an anonymous sign-in. The store's
`getCurrentUserId` throws `Not authenticated` on null; `lib/api/analytics.ts`
and `lib/notifications/api.ts` return their "not signed in" value. Don't use
`supabase.auth.getUser()`: it's a round trip to Supabase Auth, and every other
Supabase request waits behind it. RLS on every user-owned table
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
4. **`useAppStore.clear()` must run on sign-out and on any switch to
   another account.** `setAccount` does both. Otherwise the next user
   inherits the previous user's collections and verses.
5. **Device prefs survive sign-out by design.** `colorMode`, for
   one, is a device preference, not a user preference. Don't include
   them in `clear()`.
6. **`canDevSignIn` stays the only way into dev sign-in.** Don't
   loosen its dev-build or local-URL checks.

## Sharp edges

- **Bible version is not synced to Supabase.** Sign in on a new
  device, you get ESV until you change it. Documented in
  `docs/architecture/bible-versions.md`.
- **No `signed-in-on-multiple-devices` invalidation.** Standard
  Supabase Auth — refresh tokens are per-session.
- **Password lengths differ.** Sign-up and reset ask for 8 characters,
  Settings asks for 6.

## Browser checks

- `npm run sim -- flow display-name`: reader-b sees Add, saves "Bea Lopez", sees "Shown as
  Bea L.", and the name is back after a relaunch and fresh sign-in. Needs a fresh seed.
- `npm run sim -- flow sign-in-out`: reader-b signs in through the form, Settings shows
  `reader-b@example.test`, Sign Out returns to the Sign In screen.
- `npm run sim -- flow account-switch-link`: dev sign-in as reader-a, then reader-c with no
  sign-out; reader-c's "Romans 8" shows and reader-a's "Psalms" never does.

## Decisions

- 2026-11-12 · Credential fields (sign-in, sign-up, forgot and reset password) set `autoCorrect={false}`, `spellCheck={false}` and their `textContentType` · The predictive bar changed the keyboard's height on the first letter of each word, and `KeyboardAwareScrollView` re-scrolled each time (the screen jittered on a phone). It already scrolls only when the field is covered, so the scroll view is unchanged.
- 2026-11-12 · First name plus optional last name; members see "First L."; no usernames, nothing unique; no prefill · Groups join by invite code, so nobody searches for a name and uniqueness buys nothing. The last initial tells two Sarahs apart without showing a full last name to a group. The old email-handle prefill got tapped through, leaving names like "liucaelan".
