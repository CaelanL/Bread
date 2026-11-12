# Theming and UI

The app supports light and dark mode (system-following by default,
user-overridable). Theming is built on `useColorScheme()` returning
the active scheme and `Colors[scheme]` from `constants/theme.ts`
giving you the tokens. There is no Tailwind, no styled-components —
just `StyleSheet.create` per file plus inline dynamic styles.

## Color tokens

Defined in `constants/theme.ts`. `CollectionArtColors` supplies the
decorative surfaces and symbol colors for the curated collection art.
Titles, subtitles, and introductions use the core text colors on solid
surfaces.

### Light mode

| Token | Value | Use |
|---|---|---|
| `text` | `#1a1a1a` | primary text |
| `background` | `#faf8f5` | screen background |
| `tint` / `primary` | `#b08d57` | brand accent (bronze gold) |
| `recordingControl` | `#987142` | bronze mic and waveform surface with white icons |
| `recordingAction` | `rgba(0,0,0,0.10)` | submit action fill on bronze, same in both modes |
| `card` | `#ffffff` | card surfaces |
| `cardAlt` | `#f5f3f0` | secondary card surfaces |
| `fill` | `rgba(0,0,0,0.05)` | quiet fill on the page: header pills, a pressed row |
| `input` | `#f5f3f0` | input backgrounds |
| `border` | `#e0dcd6` | dividers / borders |
| `borderLight` | `#ebe7e1` | subtle dividers |
| `success` | `#22c55e` | success status |
| `warning` | `#f59e0b` | warning status |
| `error` | `#ef4444` | error status |
| `destructiveAction` | `#c93636` | swipe-delete fill in both themes, with white text |
| `tabIconDefault` | `#8a8a8a` | inactive tab icons |
| `tabIconSelected` | `#b08d57` | active tab icons |
| `icon` | `#6b6b6b` | default icon color |
| `primaryLight` | `rgba(176,141,87,0.12)` | tinted accent background |
| `engravedFill` | `rgba(245,158,11,0.12)` | engraved collection icon |
| `overlay` | `rgba(0,0,0,0.5)` | modal scrim |
| `shadow` / `white` | `#000` / `#ffffff` | utility, same in both modes |

### Dark mode

| Token | Value | Use |
|---|---|---|
| `text` | `#f5f5f5` | |
| `background` | `#1a1a1a` | |
| `tint` / `primary` | `#c9a962` | brand (lighter for contrast) |
| `recordingControl` | `#a8824c` | bronze mic and waveform surface with white icons |
| `card` | `#242424` | |
| `cardAlt` | `#2e2e2e` | |
| `fill` | `rgba(255,255,255,0.08)` | |
| `input` | `#2e2e2e` | |
| `border` | `#3a3a3a` | |
| `borderLight` | `#444444` | |
| `success` / `warning` / `error` | same as light | status colors are theme-agnostic by design |
| `tabIconDefault` | `#6b6b6b` | |
| `tabIconSelected` | `#c9a962` | |
| `icon` | `#9a9a9a` | |
| `primaryLight` | `rgba(201,169,98,0.15)` | |
| `engravedFill` | `rgba(245,158,11,0.15)` | |
| `overlay` | `rgba(0,0,0,0.6)` | |

Status colors (`success`, `warning`, `error`) are intentionally the
same in both modes — they carry semantic meaning and shouldn't
shift with theme.

Auth screens always use `Colors.dark`, with `authAccent` and
`authButton` from the same file.

A collection's accent (its `iconColor`, or `primary`) isn't a token: `withAlpha(hex, alpha)` with
`AccentAlpha.fill` (its icon square) or `AccentAlpha.wash` (the header wash) derives from it.

## Radius, motion and shadows

`constants/theme.ts` also exports `Radius`, `Motion` and `Shadows`.
`eslint.config.mjs` rejects radii, durations and press scales outside
those values, so `npm run lint` catches a stray one.

## Fonts

`constants/theme.ts` defines platform-specific font families. There
are no global size/weight tokens; per-component sizes are defined in
each file's `StyleSheet.create`.

| Platform | `sans` | `serif` | `rounded` | `mono` |
|---|---|---|---|---|
| iOS | `system-ui` | `ui-serif` | `ui-rounded` | `ui-monospace` |
| Android | `normal` | `serif` | `normal` | `monospace` |
| Web | full system stack | full serif stack | full rounded stack | full mono stack |

A few common sizes from `themed-text.tsx`:

- `default`: 16px / line-height 24
- `defaultSemiBold`: 16px / 600
- `title`: 32px / 700 / line-height 32
- `subtitle`: 20px / 700
- `link`: 16px / line-height 30 / `colors.primary`

Playfair Display (`@expo-google-fonts/playfair-display`) is loaded
as a custom font in `app/(auth)/sign-in.tsx`, the only screen that
uses it.

## Color scheme detection

`hooks/use-color-scheme.ts`:

```ts
export function useColorScheme() {
  const systemScheme = useSystemColorScheme();
  const colorMode = useAppStore((s) => s.colorMode);
  if (colorMode === 'system') return systemScheme;
  return colorMode;
}
```

- Default `colorMode` is `'system'` → follows the device.
- User can override to `'light'` or `'dark'` from Settings.
- Stored in Zustand + AsyncStorage (`app_color_mode`).
- Persisted across sign-out (it's a device preference, not a user
  preference).

`hooks/use-color-scheme.web.ts` replaces this on web and follows the
system only, so the Settings override doesn't apply there.

## The theming convention

**Invariant 8: theming uses `useColorScheme()` + `Colors[scheme]`, NOT
`ThemedText`/`ThemedView`.** Despite the names, those abstractions are
barely used. The actual convention is to call `useColorScheme()` in
each component and pull tokens from `constants/theme.ts`. Hardcoded hex
is only acceptable for status colors (error/success/warning) and the
offline/error-boundary system overlays.

```tsx
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export function MyComponent() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  return (
    <View style={{ backgroundColor: colors.card }}>
      <Text style={{ color: colors.text }}>Hello</Text>
    </View>
  );
}
```

`ThemedText` and `ThemedView` (`components/themed-text.tsx`,
`themed-view.tsx`) are used only by Expo template leftovers:
`app/modal.tsx`, `components/parallax-scroll-view.tsx` and
`components/ui/collapsible.tsx`. Don't rewrite existing components to
use them.

## `useThemeColor` hook

`hooks/use-theme-color.ts`:

```ts
useThemeColor(
  { light?: string, dark?: string },
  colorName: keyof Colors.light & keyof Colors.dark
): string
```

Returns a per-prop override if provided, otherwise the named token
from the active scheme. Used inside the themed components and
occasionally in components that need single-color overrides.

## Hardcoded colors — when it's OK

Hardcoded hex values are acceptable in two cases:

1. **System overlays that intentionally ignore theme**:
   `ErrorBoundary` (always dark with a red icon), `NoInternetOverlay`
   (always blue with white text). These are critical UI that
   shouldn't depend on the theme system being healthy.
2. **Status colors** (error red, success green, warning amber) when
   used semantically — they're the same across themes anyway.

Anywhere else, pull from `colors`. A number of older components still
have hex literals; don't copy them.

## `components/ui/` — design-system primitives

| Component | Purpose |
|---|---|
| `icon-symbol.tsx` / `icon-symbol.ios.tsx` | Cross-platform icon (SF Symbols on iOS, Material Icons elsewhere) |
| `collapsible.tsx` | Expandable disclosure |
| `Skeleton.tsx` | Loading shimmer placeholder |
| `ErrorToast.tsx` | Bottom-up animated error notification |
| `NoInternetOverlay.tsx` | Full-screen offline indicator |
| `PopoverMenu.tsx` | Floating context menu |
| `VerseReferenceBadge.tsx` | "John 3:16 KJV" badge |
| `VerseExpandModal.tsx` | Expanded verse text modal |
| `IntroVideoModal.tsx` | Dark video surface, captions, close and playback controls |
| `AddToCollectionModal.tsx` | Pick collection(s) for a verse |
| `CopyToCollectionModal.tsx` | Pick one destination for an existing saved verse |
| `ModalCard.tsx` | `ModalCard` (a centered card on a dimmed backdrop, with an X) and `modalStyles` (its type, input and button), for modal routes |
| `EngravedIcon.tsx` | Special icon for engraved verses |
| `SearchTakeover.tsx` | Search that grows out of its pill to the top and covers the screen; Cancel plays it back |
| `TopBar.tsx` | `TopBar`, `TopBarButton`, `useScrollY`, `useTopBarHeight`: a screen's bar over its scroll view (see Screen tops) |

If you're building a new reusable primitive, add it here with a
`.tsx` (and `.ios.tsx` if it needs platform divergence). Pull
colors from `Colors[scheme]`. Don't roll your own modal/button
elsewhere.

## Icons

`IconSymbol` is platform-aware:

- **iOS** (`icon-symbol.ios.tsx`): uses `SymbolView` from
  `expo-symbols` — renders native SF Symbols.
- **Android / web** (`icon-symbol.tsx`): falls back to
  `MaterialIcons` via a hand-maintained `MAPPING` object.

Adding a new icon means:

1. Find the SF Symbol name (e.g. `house.fill`).
2. Find the closest Material Icons equivalent (e.g. `home`).
3. Add a line to `MAPPING` in `icon-symbol.tsx`.
4. Use `<IconSymbol name="house.fill" size={24} color={colors.tint} />`.

The collection icon registry contributes its fallback glyphs to
`MAPPING` and provides older iOS fallbacks. Cross, sword, and praying hands
use Material Community Icons through `IconSymbol` on every platform.

Forgetting step 3 means the icon renders correctly on iOS and not
on Android / web.

## Screen tops

A screen's title lives in its content, never centered in a bar. `TopBar` floats over the scroll
view (absolute, under the status bar): back on the left, icon actions (`TopBarButton`) on the
right, and no surface until content scrolls under it, then the page colour fades in over the
first 32 pt of scroll, with no hairline. That surface (an `expo-linear-gradient`) is solid to 8 pt
above the bar's bottom and clears 20 pt below it, so content fades out into the bar rather than
meeting an edge (scroll-edge fade). The bar never shows a title; the screen's title lives only in
its content (`LargeTitle`). The tab bar has no hairline either: its background
(`tabBarBackground` in `app/(tabs)/_layout.tsx`) fades content out over the 28 pt above it. The scroll view is a Reanimated one with `onScroll` from `useScrollY`,
`paddingTop: useTopBarHeight()` and the same value as its `RefreshControl`'s `progressViewOffset`,
so the spinner shows below the bar, not behind the Dynamic Island.

Each screen picks its title. A tab's first screen (Home, Library, Settings) has `LargeTitle root`
(34/700); a pushed page (Insights, Notifications) has `LargeTitle` (28/600); the collection
screen has its name. `AppHeader` is the same bar in the layout flow, for screens whose top stays
put: the title sits beside the back button, a labelled action is a `HeaderPill`, an icon one a
`TopBarButton`. It carries a title only when the title says something the screen doesn't (a
session's reference, a chapter's "John 3"). Setup and a curated collection drop theirs: the verse
card and the collection's own name already say it.

The collection screen's top is `CollectionHeader` (`components/library/`): the accent washing down
from the top edge (an `expo-linear-gradient`, solid above the bar for a pull), a 56 pt icon square,
the name at 28/600, a secondary line, and `HeaderPill`s (one `primary`, the rest on `fill`).

Search is ours, not `headerSearchBarOptions`: the native search bar needs the native header
(off app-wide) and lives in the bar, not in a pill under a header, and the iOS 26 placements
can't be checked on the iOS 18 simulator.

## Haptics

Used sparingly. The convention is to gate them to iOS:

```ts
if (process.env.EXPO_OS === 'ios') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
```

`HapticTab`, recording and Library hold actions follow this guard.
Verse reveal and the add-verse screens also trigger haptics on Android.

| Interaction | Style |
|---|---|
| Tab press | `impactAsync(Light)` (in `HapticTab`) |
| Selection of a verse for adding | `selectionAsync()` |
| Recording start/stop | `impactAsync(Medium)` |
| Library long-press actions | `impactAsync(Light)` |
| Chunk completion | `impactAsync(Light)` |

Use `impactAsync` for taps and recording state transitions,
`selectionAsync` for selection. Don't add haptics to every Pressable —
it loses meaning.

## Style patterns

- **Module-level `StyleSheet.create`** for static styles. Cheaper
  than inline because the style object is created once.
- **Inline `style={{}}`** only for dynamic values that depend on
  theme, props, or animated state. Examples: `{ backgroundColor:
  colors.card }`, `{ transform: [{ scale: pressed ? 0.98 : 1 }] }`.
- Don't mix dynamic and static keys in the same object — they
  defeat the optimization. Either it's static (module-level) or
  it's dynamic (inline).
- No CSS, no Tailwind, no styled-components. React Native
  StyleSheet only.

## Invariants

Invariant 8 is above. Also:

1. **Static styles → `StyleSheet.create` at module level.** Dynamic
   theme/state styles → inline. Don't mix.
2. **Reusable UI primitives go in `components/ui/`.** Don't roll a
   new button or modal in a feature folder.
3. **New icons require a `MAPPING` entry** in
   `components/ui/icon-symbol.tsx` for Android/web. iOS works
   automatically with valid SF Symbol names.
4. **New haptics are gated to iOS.** Use the
   `EXPO_OS === 'ios'` guard.
5. **Every `TextInput` style spreads `InputText` first** (`constants/theme.ts`: `letterSpacing: 0`,
   `fontWeight: '400'`), then its own values. iOS on the New Architecture recycles input views and
   keeps the last input's kern and weight when the next one sets none (react-native#42589); the
   join-code field's spacing showed up in other fields on a phone. Flow: `input-spacing`.

## Sharp edges

- **`SwipeableVerseCard.tsx` has hardcoded bronze RGBA values**
  (e.g. `rgba(176,141,87,0.25)`) that should ideally come from a
  derived theme token. Not a bug, but a candidate for cleanup.
- **No design-system documentation beyond this file** —
  `components/ui/` is the de facto catalog. If a new primitive is
  added, list it here.

## Decisions

- 2026-11-10 · Translation-picker backdrops are not accessibility elements · Settings' outer Pressable otherwise grouped the entire popup, hiding individual translation choices from native accessibility and UI automation. `accessible={false}` preserves the existing layout and dismissal behavior while exposing the option rows.
- 2026-11-12 · `ModalCard`'s backdrop is a plain dim, no `BlurView` · Its routes fade natively, and a blur view under a fading parent drops its effect for the whole fade, so closing the share card flashed from blurred to sharp (Caelan's pass 3, C17).
- 2026-11-12 · Depth comes from the screen tops, not entrances: the collection's accent wash, a bar that gains the page colour only once content is under it, and a pressed-row fill · Caelan's pass 3 (C20) asked for software-like depth, kept restrained; the lists are opened many times a day, so their rows don't animate in. Everything is scroll- or touch-driven, so reduced motion has nothing to turn off; the one autoplaying motion, search lifting to the top, fades instead under reduced motion.
- 2026-11-12 · The bar has no hairline and no small title; its surface fades in over 32 pt of scroll · Caelan's pass 4 (C26): the band arriving within 8 pt read as the old nav bar popping back in, and the small title still read as a nav bar ("I wanted that small title gone").
- 2026-11-12 · Content fades out above the tab bar, which lost its hairline · Caelan wanted things scrolling under Home, Library and Settings to fade, on every screen.
- 2026-11-12 · Content fades out into the bar (a page-colour gradient under it), on every `TopBar` screen · Caelan's pass 4 (C28) asked for it in collections and the Library; one bar, one behaviour, so Home, Settings, Insights, Notifications and Details get it too.
