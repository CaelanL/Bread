# Navigation and Routing

The app uses [Expo Router 6](https://docs.expo.dev/router/) with
file-based navigation. Each file in `app/` becomes a route; folders
become nested navigators (Stack or Tabs). Auth-related routes,
authenticated tabs, and modals are organized into route groups.

## Route tree

```
app/
├── _layout.tsx                ← Root Stack, providers (network, keyboard, auth), notification handlers, hydration, auth gating
├── (auth)/                    ← Stack group: dark-mode-only auth screens
│   ├── _layout.tsx
│   ├── sign-in.tsx
│   ├── sign-up.tsx
│   └── forgot-password.tsx
├── (tabs)/                    ← Bottom tab navigator
│   ├── _layout.tsx
│   ├── home.tsx                       ← Tab: Home
│   ├── (library)/                     ← Nested Stack inside the Library tab
│   │   ├── _layout.tsx
│   │   ├── index.tsx                  ← Library list
│   │   ├── [id].tsx                   ← Collection detail
│   │   ├── add.tsx                    ← Add a verse: version, book and chapter
│   │   ├── add/[book]/[chapter].tsx   ← Verse picker for a chapter
│   │   └── setup/[id].tsx             ← Difficulty + chunk-size picker before starting a session
│   ├── settings.tsx                   ← Tab: Settings
│   ├── explore.tsx                    ← Hidden tab (`href: null`) — curated catalog, reachable from Home
│   └── insights.tsx                   ← Hidden tab (`href: null`) — reachable from Home InsightsCard
├── collections/[slug].tsx     ← Curated collection introduction and import
├── notifications.tsx          ← Notification settings, pushed from Settings
├── reset-password.tsx         ← Reachable WITHOUT auth (deep link from password-reset email)
├── dev-sign-in.tsx            ← Reachable WITHOUT auth; dev builds against a local Supabase only
├── session.tsx                ← Full-screen modal — the study session
└── modal.tsx                  ← Expo template modal, nothing links to it
```

`dev-sign-in` has no `<Stack.Screen>` entry; Expo Router registers it
from the file. It renders nothing. See `docs/architecture/auth.md`.

## Tab structure

| Tab | Route | Visible? |
|---|---|---|
| Home | `(tabs)/home` | ✓ (first in the tab layout) |
| Library | `(tabs)/(library)/index` | ✓ |
| Settings | `(tabs)/settings` | ✓ |
| Explore | `(tabs)/explore` | hidden (`href: null`) — entered from Explore collections on Home |
| Insights | `(tabs)/insights` | hidden (`href: null`) — entered from `InsightsCard` on Home |

The hidden tabs still exist as routes — they're just not in the tab
bar. To navigate to them, push the route directly:
`router.push('/insights')`.

The Library tab uses a nested Stack so that pushing a collection or
the verse-picker keeps the tab bar visible (within the tab) and back
navigation works as expected.

## Modals

Two modal styles, both handled at the root Stack:

- `app/session.tsx` — `presentation: 'fullScreenModal'`. Covers the
  entire screen, no tab bar, no back swipe (custom close button).
  Used for the immersive study session.
- `app/modal.tsx` — `presentation: 'modal'`. Standard sheet-style
  modal that slides up over the content. Template scaffold; the
  Library sub-routes (`(tabs)/(library)/[id]` etc.) are NOT modals
  even though they look like them — they're nested Stack screens.

`app/notifications.tsx` and `app/reset-password.tsx` are plain root
Stack screens.

## Dynamic routes

| Route | Param(s) |
|---|---|
| `collections/[slug].tsx` | `slug` — bundled curated collection ID |
| `(tabs)/(library)/[id].tsx` | `id` — collection `client_id`, or the virtual `mastered` / `in-progress` |
| `(tabs)/(library)/add/[book]/[chapter].tsx` | `book`, `chapter` — Bible reference; query `collectionId`, `version` |
| `(tabs)/(library)/setup/[id].tsx` | `id` — verse `client_id` |

`(tabs)/(library)/add.tsx` takes an optional `collectionId` query
param. `session.tsx` reads its config from query params, not path
params: `/session?id=<verseId>&difficulty=<d>&chunkSize=<n>`.

## Auth gating

Lives in `app/_layout.tsx`:

```tsx
useEffect(() => {
  if (!navigationState?.key || isLoading) return;

  const inAuthGroup = segments[0] === '(auth)';
  const isResetPassword = segments[0] === 'reset-password';
  const isDevSignIn = segments[0] === 'dev-sign-in';

  if (!isAuthenticated && !inAuthGroup && !isResetPassword && !isDevSignIn) {
    router.replace('/(auth)/sign-in');
  } else if (isAuthenticated && inAuthGroup) {
    router.replace('/(tabs)');
  }
}, [isAuthenticated, isLoading, segments, navigationState?.key]);
```

Three states:

- Not auth'd, in `(auth)`, `reset-password` or `dev-sign-in`: stay.
- Not auth'd, anywhere else: redirect to sign-in.
- Auth'd, in `(auth)`: redirect to `/(tabs)`.

`reset-password` is whitelisted because the user reaches it from an
email link before they have a session. `dev-sign-in` is whitelisted
because it creates the session.

## Deep links

Configured via Expo's URL scheme `com.biblemem://` (in
`app.config.js`). Auth links are handled by `handleDeepLink` in
`AuthProvider` (`lib/auth/context.tsx`):

| Link | Triggers |
|---|---|
| `com.biblemem://#access_token=...&refresh_token=...` | OAuth callback (no screen starts OAuth, see `docs/architecture/auth.md`) |
| `com.biblemem://reset-password#access_token=...&refresh_token=...&type=recovery` | Password reset |
| `com.biblemem://dev-sign-in?next=/settings&as=reader-b` | Dev sign-in, handled by the route itself |

The handler extracts tokens from the URL and calls
`supabase.auth.setSession(...)`. Auth state change then drives the
gating logic above. A notification tap routes through
`lib/notifications/deep-links.ts`, see
`docs/features/notifications.md`.

## Header / tab bar

- Tab bar uses `HapticTab` (`components/haptic-tab.tsx`) for haptic
  feedback on iOS only. The Settings tab shows a badge from
  `useSettingsBadge`.
- Active tint: `Colors[scheme].tint` (bronze gold).
- Navigator headers are off (`headerShown: false`). Screens render
  the shared `AppHeader` (`components/app-header.tsx`).

## Conventions

- **New tab screen**: add `app/(tabs)/<name>.tsx` and a
  `<Tabs.Screen>` entry in `app/(tabs)/_layout.tsx`. Set `href: null`
  if it shouldn't appear in the tab bar.
- **New screen inside the Library tab**: add a file under
  `app/(tabs)/(library)/`. It will be pushed onto the Library Stack
  by default.
- **New top-level modal**: add a file at root `app/`, register it
  in `app/_layout.tsx` with the `presentation` option you want.
- **New auth screen**: add to `app/(auth)/`. The auth Stack is
  dark-mode-only and unauthenticated.
- **Dynamic route**: file name with `[param].tsx`. Read with
  `useLocalSearchParams()`.

## Invariants

1. **Don't bypass the auth gate.** If a screen needs to be
   reachable without auth (like `reset-password`), whitelist it
   explicitly in `app/_layout.tsx`. Don't move auth gating logic
   elsewhere.
2. **The session screen is a `fullScreenModal`.** Don't change it
   to a regular Stack screen — the tab bar would re-appear over
   the recording UI.
3. **Hidden tabs (`href: null`) are still routes.** Anyone can
   `router.push('/(tabs)/insights')`. If you want to truly hide
   a route, move it out of `(tabs)/`.
4. **Tab order in `(tabs)/_layout.tsx` is the visible order.**
   `unstable_settings.anchor` in `app/_layout.tsx` is `(tabs)`, the
   root Stack's base route.

## Sharp edges

- **`unstable_settings.anchor`** is an Expo Router API marked
  unstable. If it changes upstream, the root Stack's base route may
  break.
- **Deep-link handling is in `AuthProvider`, not in
  `app/_layout.tsx`.** The provider registers the listener when it
  mounts. If you change the provider, don't accidentally break the
  deep-link handler.
- **The `(library)` nested Stack means going back from a
  collection detail returns to Library**, not to the root tab
  navigator. Test back navigation when adding new screens here.
