# Window layouts

Bread lays a screen out from the size of its window, never from the device model. Every iPhone
gets today's screens. A bigger window, the iPhone Duo's two displays or an iPad, gets layouts
that use the room.

## Window classes

`windowClass(width, height)` in `lib/layout.ts` sorts a window into one of four classes, and
`useWindowClass()` (`hooks/use-window-class.ts`) reads it live from `useWindowDimensions()`.

| Class | Rule | Who |
|---|---|---|
| `phone` | shorter side < `PHONE_SHORT_SIDE` (460) | every iPhone, either way up; a narrow iPad split |
| `wide` | not phone, width ≥ `WIDE_SIDE` (800) | the open Duo on its side, iPad |
| `outer` | not phone, width and height < 800 | the closed Duo's outer display |
| `tall` | not phone, width < 800, height ≥ 800 | the open Duo upright, iPad mini upright |

Width alone can't do it: the outer display (466 wide) and the upright inner display (669 wide)
are both narrow but are laid out differently. 460 sits 6 pt under the outer display, so an outer
display with Display Zoom falls back to `phone`.

Windows measured on the iPhone Duo simulator (iOS 27.2, `iPhone19,4`): outer 466 × 678 pt, inner
951 × 669 on its side and 669 × 951 upright. `npm run sim -- shot /dev-window` prints the window
size, class and safe-area insets (`app/dev-window.tsx`, dev builds against a local database only).

## Live sizes

A fold, an unfold or a rotation changes the window while a screen is open, so nothing reads the
window size at module load. Read it in render with `useWindowDimensions()` (the session's page
width, `VerseCard` and `ResultCard` heights).

## Orientation

`app.config.js` keeps `orientation: "portrait"`. On iOS 27 that's enough: the open Duo still gives
Bread both inner windows (951 × 669 and, turned, 669 × 951), and the outer display stays upright
when the phone turns. No `expo-screen-orientation`, no native change.

## The iPhone Duo simulator

- `--device duo` on `npm run sim -- shot`, `flow`, `install` and `stop` uses the `iPhone Duo`
  simulator instead of iPhone 16 Pro. `install --local --device duo` builds for it; it keeps its own
  record of the installed build.
- It boots closed. Fold, open and turn it with Claude's iOS Simulator tool (`set_posture`, `rotate`);
  neither `simctl` nor Maestro can. Leave it running between commands with `--keep`.
- `shot --device duo --display outer|inner` picks the display to capture (default outer); the file
  name ends in it. Outer shots are 1398 × 2034 px, inner ones 2853 × 2007 on its side.
- `--dark` (any device) shoots in dark appearance. Every run sets the appearance when it boots, so
  without `--dark` the simulator is light.
- Maestro works on the closed Duo only. With it open, Maestro reads the screen in the outer
  display's coordinates (offset by −203, −273 and clipped to 466 × 678), so taps and scrolls miss.

## Study setup

Study setup is the one screen that looks different on every iPhone, not only on wide windows; its
parts live in `components/study/setup/` so the wide layouts reuse them. On a phone, top to bottom:

- `TopBar` with back, ⋯ and, in its `center`, `ReferenceBubble`: the reference in a `GlassPill`
  in place of a "Study setup" title.
- `VersePreview`: the opening lines on `cardAlt` (2 lines under 870 pt of `useSafeAreaFrame`
  height, 3 under 920, else 4) with ⤢ at the top right. Hide verses shows "Verse hidden".
- `DifficultySwitcher`: a `controlFill` capsule track with a raised `controlThumb` that slides to
  the chosen level (`Motion.expandMs`, none under Reduce Motion). Legend dots and check as before.
- `ProgressCard`: three best scores, then the engraved row (icon, state, "N / 10" on one line, bar,
  then the callout, unlock time or tagline), on a white `card` with `Shadows.card`.
- `ChunkRow` (passages only): the size in a capsule that opens `ChunkSizeModal`, and All.
- `StartButton`: a 56 pt full-width `actionFill` capsule docked over the page fade.

Spacing: 24 pt between sections, section titles 17 pt semibold, 10 pt from a title to its control.
The bubble, ⤢ and the preview text open `PassageCard`, the whole passage with numbered verses. It
grows out of whatever was tapped (measured with `measureInWindow`) over `Motion.paneMs` on
`Motion.easing` while the page blurs, and shrinks back into it on close; Reduce Motion fades it.

## Navigation

`app/(tabs)/_layout.tsx` picks the tab bar by class; phones keep today's fade bar untouched.

- `wide` and `outer`: `TabRail` (`components/ui/TabRail.tsx`) on the right (`tabBarPosition: 'right'`,
  so screens lay out beside it). 76 pt wide (72 on outer, 46 pt buttons), or the safe area's right inset
  when that's wider: on the Duo the status bar (time, Wi-Fi) runs down the right edge and the inset is 84.
  Top: the focused screen's actions, starting under the status bar (`STATUS_ROOM`: 106 pt on its side,
  160 on the outer display, measured). Bottom, 20 pt up: a vertical `GlassPill` of 50 pt tab circles,
  the selected one on `primaryLight` in `tint`.
- `tall`: `TabPill`, a floating glass pill of 96 × 54 tabs with labels, 24 pt from the bottom, the page
  fading out above it. It reports its height, so `useBottomTabBarHeight()` stays right.
- Both keep the `tab-*` testIDs, the selected state, the Settings badge (an `error` dot with the count)
  and the light haptic on press in.

**Rail actions.** Inside the tabs, `RailContext` says the rail shows. A `TopBar` there renders no
actions; while its screen is focused, `useRailActions` puts its `children` in the rail's top slot,
and `TopBarButton` draws itself as a `GlassButton` there (`RailSlotContext`). Closures keep working
(setup's ⋯ opens Reset as before). A screen's `PopoverMenu` takes `useMenuAnchor()` from `TopBar.tsx`:
under the bar's right end, or, railed, level with the rail's first action and just left of the rail. Screens outside the tabs (session, notifications) keep their
actions in the bar. The slot's store is named `useRailSlot`: the React Compiler treats only `use*`
names as hooks and skipped re-reading a store named otherwise ("Rendered fewer hooks").

## Home

Same components and data as on a phone; `VOTMCard`, `InsightsCard` and `ExploreCollections` read
the class themselves.

- `wide` (Main board): title 26 pt under the safe top, 28/24 side padding. The monthly card (text
  27/38, at most 420 wide) and a 330 pt Insights card share a row at least 316 tall; then Explore as
  four tiles (`CuratedCollectionCard tile`: 100 pt banner, serif title, one-line subtitle,
  "12 passages · N saves").
- `tall` (Home-Portrait): title 54 pt from the top (the status bar only fills the top right corner),
  24 pt sides, the monthly card at least 262 tall (text 26/36), Insights as one row of three cells,
  Explore as three tiles.
- `outer` (Home-Outer): today's Home with 18/10 side padding, 16 pt gaps and 17/25 monthly text.
- Insights on the open Duo is a white card with a cell per number (streak, mastered, in progress),
  stacked on its side so it fills the row, in one row upright.

## Browser checks

- `npm run sim -- shot /dev-window --device duo`: "466 × 678", "outer", and the glass buttons and
  bubble over bronze text. Opened (`set_posture open`), `--display inner`: "951 × 669", "wide";
  turned (`rotate left`): "669 × 951", "tall". Add `--dark` for the dark glass.
- Home on the Duo: `npm run sim -- shot "/(tabs)/(home)/home" --device duo` closed (outer), then
  opened `--display inner` on its side and turned upright, each also `--dark`: the rail or pill, and
  the board's layout. On iPhone 16 Pro, Home matches today's.
- Rail: `npm run sim -- flow duo-rail --device duo` on the closed Duo: tabs switch from the rail, and
  setup's More opens its menu beside the rail (Reset Progress, then Cancel). The open Duo can't be tapped.
- Study setup on iPhone 16 Pro, light and `--dark`: `shot` the setup routes for `seed-psalm-23-1-3`,
  `seed-john-3-16` (review due) and `seed-romans-8-28` as reader-a, `seed-c-romans-8-1` (engraved),
  `seed-32-2` (locked) and `seed-32-4` (five verses) as reader-c. Taps: `flow setup-iphone`; Hide
  verses: `flow hide-verses`.

## Decisions

- 2026-11-23 · Classes use width and height, not width alone · the outer display gets the rail and the upright inner display doesn't, at nearly the same width.
- 2026-11-23 · Stay portrait-only · the probe on the Duo simulator showed the inner display already gets both orientations and the outer stays upright, so the native change (and its store build) isn't needed.
- 2026-11-23 · iPhone setup keeps today's order (preview, Difficulty, Your Progress, Verses per chunk); only the look follows the Duo boards · Caelan: "Yes, all leans" (O4); the restyle shouldn't move anything a reader knows.
- 2026-11-23 · Chunk size keeps today's sheet, restyled, not a native menu · a native menu needs `@expo/ui`, a native change, and this feature ships over the air (O2).
- 2026-11-23 · On the phone, back and ⋯ stay plain bar icons; only the reference is glass · the bar has no surface on every other screen, and the boards' glass buttons belong to the wide layouts.
- 2026-11-23 · The boards' deep bronze (#8f6a3a: Review now callout, tagline, selected All) is `tint`/`primary`, and the selected difficulty is the raised thumb, not solid bronze · tokens with a dark mode, and Q17 keeps today's bronze.
- 2026-11-23 · The preview card drops its reference pill · the bubble already names the verse.
- 2026-11-23 · The rail is at least as wide as the right safe inset (84 on the Duo, not the boards' 76/72) · the status bar runs down that edge and would sit on content otherwise.
- 2026-11-23 · No clock drawn in the rail; actions start under the system status bar · the boards drew the status bar; iOS draws its own there.
- 2026-11-23 · No Due for review card on Home · Caelan (O3); Insights takes its space.
- 2026-11-23 · Home's Insights card on the Duo shows streak, mastered and in progress, not Time studied · time studied is a server read only Insights makes; Home keeps today's data.
- 2026-11-23 · Explore tiles use a 100 pt banner upright too (board: 110) · one banner size for both.
