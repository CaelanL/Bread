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

Study setup, the collection, the shared collection and the study session on each class:
[wide study screens](wide-study.md).

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

## Library

On its side and on the outer display (Library-Toggle, Library-Outer boards) the title sits 26 pt
under the safe top (28/24 side padding on its side, 20/10 outside) with a 40 pt grid ⇄ list button
beside it. The rail holds Add, then Edit as a glass word (`GlassButton text`).

- **Grid**: `CollectionTile`, four columns on its side and two outside, 18 pt apart, 22 between
  rows. A square in the row's own colours (`collectionSquare`, shared with the list row) with two
  faint orbits, a 64 pt icon, the mastered or engraved badge in its corner (30 pt); under it the
  name with the due pill, and the row's subtitle. Long press opens the row's menu
  (`collectionMenuItems`); there's no swipe, Delete is in the menu.
- **List**: today's rows. Edit, and Reorder from a menu, always show the list (drag handles).
- **The choice** is a device setting, `libraryView` in the store (AsyncStorage `library_view`),
  shared by both displays. `libraryView()` in `lib/layout.ts`: until one is chosen, a grid on its
  side and a list outside; phones and the open Duo upright always get today's list, with no button.

## Add verse

- `wide` (Bible-Picker board): the add screen is a 320 pt books column (title, quick add, books,
  a book's chapters five across, the open chapter outlined in `tint`) beside the chapter. A chapter
  tap shows it in the pane instead of pushing, with no 500 ms window (it doesn't leave the screen);
  book rows keep their same-book guard. The pane is `ChapterVerses` (the chapter route's body: fetch,
  the range gesture, Add), with the title in the content, text at most 498 wide, and the reference,
  translation and Add docked low over a fade. Back and the translation (a glass word) are in the rail.
  The chapter route on a wide window (an unfold, a link) goes back to the add screen with that
  chapter open (`book`, `chapter`, and an `opened` time so a second redirect to the same chapter
  still opens it). A fold from wide shows today's add screen; the open chapter and any selection
  are dropped, so an unfold after it shows the books alone.
- `tall` (Bible-Picker-Portrait2) and `outer`: today's drill-down, stretched.

## Settings

- `wide` (Settings board): a 340 pt list on `cardAlt` (`SettingsList` in `components/settings/SettingsSplit.tsx`)
  beside the chosen topic's pane. Rows: Send feedback; Translation, Appearance, Review, Notifications; Account,
  About, each with its value (the translation in the text colour, the email under Account). The pane has the
  topic's title (28 pt) and its controls: Feedback is the form (`FeedbackForm`; Done starts a fresh one);
  Translation lists the versions, a tap calls `setBibleVersion` (no sheet); Appearance, Review, Account (Delete
  Account under it) and About reuse the phone's rows and sheets; Notifications is the notifications page's body
  (`NotificationSettings`) with Save as a glass word in the rail, dimmed until there's an edit. Leaving it with
  unsaved edits asks to discard, like Back. Settings opens on Translation.
- `/notifications` and `/feedback` on a wide window (an unfold, a link) `dismissTo` Settings with `topic` and an
  `opened` time, which picks that pane. A fold from wide shows today's Settings; an unsaved notifications draft
  or feedback note in the pane is dropped. For shots, `shot "/(tabs)/settings?topic=<topic>"`.
- `outer` (Settings-Outer): today's page, the title 26 pt under the safe top, 18/10 side padding. `tall`: today's.
- Off the rail, `TopBar` pads its right side by the safe area's right inset, and the Notifications and Feedback
  pages pad their content by it, so Save and the note clear the status bar down the outer display's right edge
  (0 on an iPhone).

## Browser checks

- `npm run sim -- shot /dev-window --device duo`: "466 × 678", "outer", and the glass buttons and
  bubble over bronze text. Opened (`set_posture open`), `--display inner`: "951 × 669", "wide";
  turned (`rotate left`): "669 × 951", "tall". Add `--dark` for the dark glass.
- Home on the Duo: `npm run sim -- shot "/(tabs)/(home)/home" --device duo` closed (outer), then
  opened `--display inner` on its side and turned upright, each also `--dark`: the rail or pill, and
  the board's layout. On iPhone 16 Pro, Home matches today's.
- Library: `npm run sim -- flow duo-library --device duo` on the closed Duo: list, grid, a tile's
  menu, Reorder shows the list, a tile opens its collection; it ends on the grid. Then
  `shot "/(tabs)/(library)" --as reader-c --device duo --display inner` opened: the four-column grid.
- Picker: `shot "/(tabs)/(library)/add/Romans/8" --device duo --display inner` opened on its side:
  books with Romans 8 outlined beside the chapter; turned upright: today's chapter screen.
- Settings: `npm run sim -- flow duo-settings --device duo` on the closed Duo: Settings from the rail, the Send
  feedback and Notifications pages clear of the status bar, notifications allowed. Opened, `shot
  "/(tabs)/settings?topic=notifications" --as reader-a --device duo --display inner`: the list, the Notifications
  pane, Save in the rail. Closed on `/notifications` (`shot /notifications --device duo --keep`), then opened: the
  same pane; closed again: today's Settings.
- Rail: `npm run sim -- flow duo-rail --device duo` on the closed Duo: tabs switch from the rail, and
  setup's More opens its menu beside the rail (Reset Progress, then Cancel). The open Duo can't be tapped.

## Decisions

- 2026-11-23 · Classes use width and height, not width alone · the outer display gets the rail and the upright inner display doesn't, at nearly the same width.
- 2026-11-23 · Stay portrait-only · the probe on the Duo simulator showed the inner display already gets both orientations and the outer stays upright, so the native change (and its store build) isn't needed.
- 2026-11-23 · The rail is at least as wide as the right safe inset (84 on the Duo, not the boards' 76/72) · the status bar runs down that edge and would sit on content otherwise.
- 2026-11-23 · No clock drawn in the rail; actions start under the system status bar · the boards drew the status bar; iOS draws its own there.
- 2026-11-23 · No Due for review card on Home · Caelan (O3); Insights takes its space.
- 2026-11-23 · Home's Insights card on the Duo shows streak, mastered and in progress, not Time studied · time studied is a server read only Insights makes; Home keeps today's data.
- 2026-11-23 · Explore tiles use a 100 pt banner upright too (board: 110) · one banner size for both.
- 2026-11-24 · The Library grid ⇄ list is one device setting, not saved to the account, a grid on its side and a list outside until chosen · the two boards draw those defaults; no data changes allowed.
- 2026-11-24 · Grid squares use the list row's colours, not the boards' curated gradients · the Library rows have no gradients today; same data as the phone.
- 2026-11-24 · Reordering always shows the list · a drag in a wrapping grid is a different gesture; the list's drag and move actions already work.
- 2026-11-24 · The open Duo upright keeps today's Library (no grid) · Q20: undrawn upright screens use the phone layout.
- 2026-11-24 · Send feedback is a Settings topic with the form in the pane, not a pushed page · the board lists it like the others; a pushed page would stretch across the wide window.
- 2026-11-24 · On wide, Translation lists the versions in its pane instead of the sheet · the pane has the room; same `setBibleVersion`.
- 2026-11-24 · Settings on wide opens on Translation · nothing specifies it; Send feedback would open on an empty form.
- 2026-11-24 · A fold drops an unsaved notifications draft or feedback note in the pane · the collection's rule (a fold shows today's list); keeping it would mean holding the draft outside the pane.
- 2026-11-24 · Settings-Outer's bottom fade isn't drawn · like Home-Outer.
