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
│   ├── (home)/                        ← Nested Stack inside the Home tab
│   │   ├── _layout.tsx                ← `initialRouteName: 'home'`
│   │   ├── home.tsx                   ← Home
│   │   ├── explore.tsx                ← Curated catalog, pushed from Explore collections on Home
│   │   └── insights.tsx               ← Pushed from Home InsightsCard
│   ├── (library)/                     ← Nested Stack inside the Library tab
│   │   ├── _layout.tsx
│   │   ├── index.tsx                  ← Library list
│   │   ├── [id].tsx                   ← Collection detail
│   │   ├── add.tsx                    ← Add a verse: quick-add field, version, book and chapter
│   │   ├── add/[book]/[chapter].tsx   ← Verse picker for a chapter
│   │   └── setup/[id].tsx             ← Difficulty + chunk-size picker before starting a session
│   └── settings.tsx                   ← Tab: Settings
├── collections/[slug].tsx     ← Curated collection introduction and import
├── join/[code].tsx            ← Shared-collection invite sheet (transparent modal)
├── join/index.tsx             ← Typed invite code entry (transparent modal)
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
| Home | `(tabs)/(home)/home` | ✓ (first in the tab layout) |
| Library | `(tabs)/(library)/index` | ✓ |
| Settings | `(tabs)/settings` | ✓ |

Home and Library each use a nested Stack, so pushing a screen keeps the
tab bar visible, animates in, and supports the back swipe. Explore
(`/explore`) and Insights (`/insights`) are Home stack screens. Their
"Back to Home" header button calls `router.back()`. The Home stack's
`initialRouteName` is `home`, so a deep link to `/explore` still has
Home under it. A tab keeps its stack when you switch away and back.
`npm run sim -- flow home-stack` checks this and that a double tap on a
curated card opens one introduction. Maestro cannot start the iOS edge
swipe, so check the swipe on a device.

## Modals

Two modal styles, both handled at the root Stack:

- `app/session.tsx` — `presentation: 'fullScreenModal'`. Covers the
  entire screen, no tab bar, no back swipe (custom close button).
  Used for the immersive study session.
- `app/modal.tsx` — `presentation: 'modal'`. Standard sheet-style
  modal that slides up over the content. Template scaffold; the
  Library sub-routes (`(tabs)/(library)/[id]` etc.) are NOT modals
  even though they look like them — they're nested Stack screens.

`app/join/[code].tsx` and `app/join/index.tsx` are `transparentModal`
with a fade: a dimmed sheet over whatever was open
([shared collections](../features/shared-collections.md#in-the-app)).

`app/notifications.tsx` and `app/reset-password.tsx` are plain root
Stack screens.

Home also presents the [intro player](../features/home.md#encouragement-video) through a React Native modal; it adds no route or tab.

## Dynamic routes

| Route | Param(s) |
|---|---|
| `collections/[slug].tsx` | `slug` — bundled curated collection ID |
| `join/[code].tsx` | `code` — invite code, normalized (upper case, spaces and dashes dropped) |
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

A signed-out visit to `join/<code>` stashes the code (`lib/shared/pending-join.ts`) before the
redirect; once authenticated with a navigator key, an effect after the gate pushes
`/join/<code>`, so an invite tapped while signed out opens after sign-in.

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
| `com.biblemem://join/<code>` | The invite sheet, routed by Expo Router to `join/[code]` |

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
  `<Tabs.Screen>` entry in `app/(tabs)/_layout.tsx`.
- **New screen inside the Home or Library tab**: add a file under
  `app/(tabs)/(home)/` or `app/(tabs)/(library)/`. It will be pushed
  onto that tab's Stack by default.
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
3. **Screens pushed from a tab belong in that tab's Stack group.**
   A hidden tab (`href: null`) opens as a tab switch, with no push
   animation and no back swipe. Every route under `(tabs)/` is
   reachable by URL; to truly hide one, move it out of `(tabs)/`.
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
