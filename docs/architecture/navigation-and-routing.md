# Navigation and Routing

> **Status: Living document.** Update when routes are added/removed,
> tab structure changes, or auth gating logic changes. Read before
> adding a screen, modal, deep link, or tab.

The app uses [Expo Router 6](https://docs.expo.dev/router/) with
file-based navigation. Each file in `app/` becomes a route; folders
become nested navigators (Stack or Tabs). Auth-related routes,
authenticated tabs, and modals are organized into route groups.

## Route tree

```
app/
├── _layout.tsx                ← Root Stack + AuthProvider, color scheme, font loading, auth gating
├── (auth)/                    ← Stack group: dark-mode-only auth screens
│   ├── _layout.tsx
│   ├── sign-in.tsx
│   ├── sign-up.tsx
│   └── forgot-password.tsx
├── (tabs)/                    ← Bottom tab navigator
│   ├── _layout.tsx
│   ├── home.tsx                       ← Tab: Home (default)
│   ├── (library)/                     ← Nested Stack inside the Library tab
│   │   ├── _layout.tsx
│   │   ├── index.tsx                  ← Library list
│   │   ├── [id].tsx                   ← Collection detail
│   │   ├── add.tsx                    ← Add new collection
│   │   ├── add/[book]/[chapter].tsx   ← Verse picker for a chapter
│   │   └── setup/[id].tsx             ← Difficulty + chunk-size picker before starting a session
│   ├── settings.tsx                   ← Tab: Settings
│   ├── explore.tsx                    ← Hidden tab (`href: null`) — reachable via Add flow
│   └── insights.tsx                   ← Hidden tab (`href: null`) — reachable from Home InsightsCard
├── reset-password.tsx         ← Reachable WITHOUT auth (deep link from password-reset email)
├── session.tsx                ← Full-screen modal — the study session
└── modal.tsx                  ← Generic modal scaffold
```

## Tab structure

| Tab | Route | Visible? |
|---|---|---|
| Home | `(tabs)/home` | ✓ (default — `unstable_settings.anchor`) |
| Library | `(tabs)/(library)/index` | ✓ |
| Settings | `(tabs)/settings` | ✓ |
| Explore | `(tabs)/explore` | hidden (`href: null`) — entered programmatically from the verse-add flow |
| Insights | `(tabs)/insights` | hidden (`href: null`) — entered from `home.tsx` InsightsCard |

The hidden tabs still exist as routes — they're just not in the tab
bar. To navigate to them, push the route directly:
`router.push('/(tabs)/insights')`.

The Library tab uses a nested Stack so that pushing a collection or
the verse-picker keeps the tab bar visible (within the tab) and back
navigation works as expected.

## Modals

Two modal styles, both handled at the root Stack:

- `app/session.tsx` — `presentation: 'fullScreenModal'`. Covers the
  entire screen, no tab bar, no back swipe (custom close button).
  Used for the immersive study session.
- `app/modal.tsx` — `presentation: 'modal'`. Standard sheet-style
  modal that slides up over the content. Generic scaffold; the
  Library sub-routes (`(tabs)/(library)/[id]` etc.) are NOT modals
  even though they look like them — they're nested Stack screens.

## Dynamic routes

| Route | Param(s) |
|---|---|
| `(tabs)/(library)/[id].tsx` | `id` — collection UUID |
| `(tabs)/(library)/add/[book]/[chapter].tsx` | `book`, `chapter` — Bible reference |
| `(tabs)/(library)/setup/[id].tsx` | `id` — collection UUID |

`session.tsx` reads its config from query params, not path params:
`/session?id=<verseId>&difficulty=<d>&chunkSize=<n>`.

## Auth gating

Lives in `app/_layout.tsx`:

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

- Not auth'd, in `(auth)` or `reset-password`: stay.
- Not auth'd, anywhere else: redirect to sign-in.
- Auth'd, in `(auth)`: redirect to `/(tabs)`.

`reset-password` is whitelisted because the user reaches it from an
email link before they have a session.

## Deep links

Configured via Expo's URL scheme `com.biblemem://` (in
`app.config.js`). Handled by the Supabase deep-link handler in
`lib/api/client.ts`:

| Link | Triggers |
|---|---|
| `com.biblemem://#access_token=...&refresh_token=...` | OAuth callback (Google sign-in) |
| `com.biblemem://reset-password?type=recovery&access_token=...` | Password reset |

The handler extracts tokens from the URL and calls
`supabase.auth.setSession(...)`. Auth state change then drives the
gating logic above.

## Header / tab bar

- Tab bar uses `HapticTab` (`components/haptic-tab.tsx`) for haptic
  feedback on iOS only.
- Active tint: `Colors[scheme].tint` (bronze gold).
- Headers per screen are configured in each `_layout.tsx` (Stack
  options) or with `<Stack.Screen options>` inside the screen file.
- The shared header for the tabs lives in `components/app-header.tsx`.

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
4. **Tab order in `(tabs)/_layout.tsx` is the visible order.** The
   `unstable_settings.anchor` set to `home` makes Home the default
   landing tab — keep this in sync if you reorder.

## Sharp edges

- **`unstable_settings.anchor`** is an Expo Router API marked
  unstable. If it changes upstream, the default tab behavior may
  break.
- **Deep-link handling is in `lib/api/client.ts`, not in
  `app/_layout.tsx`.** This is unusual — the client module
  registers the listener at import time. If you change Supabase
  client setup, don't accidentally break the deep-link handler.
- **The `(library)` nested Stack means going back from a
  collection detail returns to Library**, not to the root tab
  navigator. Test back navigation when adding new screens here.
