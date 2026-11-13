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
│   │   ├── setup/[id].tsx             ← Difficulty + chunk-size picker before starting a session
│   │   └── shared/[id].tsx            ← Who's where (titled Details), pushed from a shared collection's group progress
│   └── settings.tsx                   ← Tab: Settings
├── collections/[slug].tsx     ← Curated collection introduction and import
├── join/[code].tsx            ← Shared-collection invite (transparent modal)
├── join/index.tsx             ← Typed invite code entry (transparent modal)
├── share/[id].tsx             ← Share a collection, or `new`: name, share, code and members (transparent modal)
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

Back is a swipe from anywhere on the page, not only the edge (`fullScreenGestureEnabled` on the
root, Home and Library stacks), except on Details, whose grid scrolls sideways. A row that swipes
to delete (`SwipeableVerseCard`) claims only a leftward drag while closed and fails on a rightward
one, so the swipe back gets it; an open row takes a rightward drag to close.

## Modals

Two modal styles, both handled at the root Stack:

- `app/session.tsx` — `presentation: 'fullScreenModal'`. Covers the
  entire screen, no tab bar, no back swipe (custom close button).
  Used for the immersive study session.
- `app/modal.tsx` — `presentation: 'modal'`. Standard sheet-style
  modal that slides up over the content. Template scaffold; the
  Library sub-routes (`(tabs)/(library)/[id]` etc.) are NOT modals
  even though they look like them — they're nested Stack screens.

### Modal routes

`app/join/[code].tsx`, `app/join/index.tsx` and `app/share/[id].tsx` are `transparentModal`
with a fade, each a `ModalCard` over whatever was open
([shared collections](../features/shared-collections.md#in-the-app)). An invite can open over
the share modal, and Open leaves both with one `router.dismissTo(<collection>)`.

Don't hold an RN `Modal` in a screen's state while a modal route can present over it. The
native dismiss takes the RN modal's view controller with it, React still thinks it's shown, and
that screen can't present another RN `Modal` (the Library's + did nothing). So the Library closes its +
menu, name modal and card menus when it loses focus. And don't chain
`router.dismissAll()` with `router.push()`: the push is resolved against the modal still on
top, so it pushes a second copy of `(tabs)` onto the root stack.

`ModalCard`'s backdrop is hidden from accessibility (`accessibilityElementsHidden`,
`importantForAccessibility="no-hide-descendants"`), never `accessible={false}`. With
`accessible={false}`, a modal route reopened after an X close read as an empty window to
VoiceOver and Maestro, on both `transparentModal` and `containedTransparentModal` but not
`modal`. Bisected on the simulator: the card without that backdrop, or with it hidden as above,
stays reachable. It isn't react-native-screens recycling the screen (`RNSScreen` returns NO from
`shouldBeRecycled`) or native-stack's `aria-hidden` (Fabric doesn't parse it on a screen; removing
it changed nothing). The UIKit step that empties the window is unproven. One path still reads
empty: after an X close, opening and cancelling New collection's name modal (an RN `Modal`; a
bare one holding only a View and Cancel does the same, the + menu doesn't) makes the next modal
route (Share…, Join with code) read as empty to Maestro, and so likely to VoiceOver. Touch still
works, and the modal route after that one reads normally. Hiding the name modal's backdrop,
dropping its blur, Reanimated view or autoFocus, and keeping it mounted changed nothing, so
`library-plus` still relaunches before that leg. Flow: `library-plus`
closes the share modal and Join with code with the X and reopens Join with code.

`app/notifications.tsx` and `app/reset-password.tsx` are plain root
Stack screens.

Home also presents the [intro player](../features/home.md#encouragement-video) through a React Native modal; it adds no route or tab.

## Dynamic routes

| Route | Param(s) |
|---|---|
| `collections/[slug].tsx` | `slug` — bundled curated collection ID |
| `join/[code].tsx` | `code` — invite code, normalized (upper case, spaces and dashes dropped) |
| `share/[id].tsx` | `id` — collection `client_id` to share or manage, or `new` to name and share a new one; `view=members` shows only the members |
| `(tabs)/(library)/[id].tsx` | `id` — collection `client_id`, or the virtual `mastered` / `in-progress` |
| `(tabs)/(library)/add/[book]/[chapter].tsx` | `book`, `chapter` — Bible reference; query `collectionId`, `version` |
| `(tabs)/(library)/setup/[id].tsx` | `id` — verse `client_id` |
| `(tabs)/(library)/shared/[id].tsx` | `id` — the shared collection's local `client_id` (as `[id].tsx`); opened with nothing under it, Back replaces to that collection |

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

A signed-out visit to `join/<code>` stashes the code in AsyncStorage (`lib/shared/pending-join.ts`)
before the redirect, so it survives sign-up with email confirmation and an app kill. Once
authenticated with a navigator key, an effect after the gate replaces to the Library, pushes
`/join/<code>` and clears the stash, so closing and Join both land on the Library.
`dev-sign-in?next=/join/<code>` does the same. `Q1ExplainerCard` waits until `Motion.exitMs`
after `JoinInvite` unmounts (`useUxFlagsStore.inviteOpen`): an RN `Modal` presented over the
modal route, or as it closes, never shows and leaves an invisible layer that takes every tap.

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
| `com.biblemem://join/<code>` | The invite modal, routed by Expo Router to `join/[code]` |
| `https://sendlabs.dev/bread/join/<code>` | The same modal: a Universal Link (`associatedDomains` in `app.config.js`), rewritten to `/join/<code>` by `app/+native-intent.tsx` (`joinRouteFromLink`) |

Invite links are web links because chat apps only make `https://` tappable (iMessage links
`com.biblemem://`, WhatsApp doesn't). sendlabs.dev is Caelan's site (repo `sendlabs-portfolio`,
on Vercel): its `/.well-known/apple-app-site-association` claims only `/bread/join/*` for
`G94DG594W9.com.caelanliu.biblemem`, and `/bread/join/[code]` is the page someone without Bread
sees when the app didn't open: Open in Bread (`com.biblemem://join/<code>`), Get Bread, then the code. iOS verifies the claim
through Apple's CDN when Bread installs, so it works only in a store or EAS build, never before
sendlabs.dev serves the file.

### Invite handoff

Someone without Bread who opens an invite link lands on sendlabs.dev's join page, which posts
`record` to the `invite-handoff` edge function: the code plus a hash of the caller's IP
(`public.invite_handoffs`, service role only, rows live an hour). On the first sign-in of an
install, `claimInstallHandoff` (`lib/shared/pending-join.ts`, called from the pending-invite
effect in `app/_layout.tsx`) posts `claim` and opens `/join/<code>` for the newest match; a
claimed row is deleted and the install never asks again. It's a guess by network, so a
household on one Wi-Fi can match the wrong invite: the join modal still needs Join.
Flow: `npm run sim -- flow invite-handoff`.

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
- Navigator headers are off (`headerShown: false`). Screens draw their own top
  ([theming](theming-and-ui.md#screen-tops)): `TopBar` over a scroll view, or `AppHeader`
  (`components/app-header.tsx`) where it stays put.

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

## Decisions

- 2026-11-12 · Swipe back from anywhere on pushed screens, and swipe-to-delete rows claim only leftward drags while closed · Swiping back from a collection often took two tries (Caelan's pass 4, C23): a verse row's pan activated at 10 pt in either direction, so a back swipe starting on a row raced the edge recognizer, and react-native-screens only makes scroll views wait for the edge, not gesture-handler pans. Swiping from anywhere is how Slack, Spotify and iOS 26's own apps go back; react-native-screens turns off iOS 26's content swipe and offers this instead.
- 2026-11-12 · The shared-collection modals (share, join, typed code, display name) are native modal routes rendering `ModalCard`, not RN `Modal`s in screen state · An invite opened over the RN-modal share sheet left the Library unable to present its next modal; native modal routes unwind together.
