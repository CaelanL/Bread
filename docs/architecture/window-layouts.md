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

## Collection and study setup

On `wide`, `app/(tabs)/(library)/[id].tsx` puts the verse list (340 pt) on the left and the selected
verse's setup on the right; other classes get the phone screen. `CollectionList`
(`components/library/`) is the list for both: on a phone it's the whole screen with its `TopBar`; on
wide it has no bar, its share and ⋯ are glass buttons at the list's top right, a row tap selects
(highlighted in `primaryLight`) instead of opening setup, and a row stays selected while there are
rows (the first in the current sort, again if the selected one leaves). Loading and an empty
collection show the list full width. Search fills the list only (`SearchTakeover` `area`).

- Glass back and sidebar buttons (`sidebar-toggle`, "Hide verse list" / "Show verse list", with an
  `expanded` state) sit 16 pt from the top left and never move. The list's ⋯ is "Collection options",
  the rail's ⋯ "Verse options".
- `StudySetupPane` (`components/study/setup/`) holds one verse's setup (`useStudySetup`, keyed by
  verse, so each verse restores its own saved difficulty and chunk size). Reset Progress is the ⋯ in
  the rail.
- List showing: `SetupColumn`, the phone's column (3 preview lines, 32 pt sides, Start docked), with
  the reference bubble centred over it.
- List hidden: the verse in a `pane`-tinted pane (51% of the width, `paneBorder` hairline) in the study
  `VerseCard` font at `verseFontSize`, cut to the lines that fit, tapping it opens the passage; ⤢ as a
  glass button at the pane's top right; on the right, Your Progress, Difficulty and Verses per chunk
  scroll above a docked Start (larger text). The bubble sits centred over the verse pane, narrowed to clear the buttons.
- Hide verses: `hiddenLineWidths` bronze lines (`primaryLight`) and a Show verse button instead of
  the text; rows drop their text line as on a phone.
- The collapse is one shared value running linearly over `Motion.paneMs`; `paneShift` puts it on
  `Motion.easing` for the moving parts (the list slides out as one piece, the pane's left edge and
  the bubble follow). The list-open layout fades out over the first 120 ms and the hidden one fades
  in from 200 ms, rising 8 pt; only the resting layout stays mounted. Reduce Motion: everything fades
  and the panes jump halfway. Selection and the collapse last while the screen is open, folds included. Phone and wide render
  the same tree, so a fold keeps the list's scroll and an open search.
- Setup opened straight on wide (a link, Review now) is the list-hidden layout with back only.
- The passage card is at most 560 wide (22/34 text) and the chunk sheet at most 280 wide on wide.

## Shared collection

On `wide`, a shared collection with others in it opens with the group's Details in the right pane
(the Shared-Collection board) instead of a verse's setup, until a row is tapped. The header's progress
line, its people line and the list's ⋯ → Details bring it back; the progress line is highlighted
(`primaryLight`) while Details shows, and no row is. Phones keep the pushed Details route and the
member sheet.

- `GroupDetailsPane` (`components/shared/`) holds `GroupDetails`, the phone route's body, as the
  setup's white cards: the group's progress (figure, bar, "N of M verses mastered by everyone"), then
  Verses (the grid and legend) and Members (`MemberRow`, the owner's actions) under 17 pt titles, 24 pt
  apart. The collection's name sits in a glass bubble (VoiceOver: "Details, <name>"), with no title.
- List showing: the cards stack in the pane (32 pt sides). List hidden: Verses and Members side by side
  (Members 320 wide), the bubble centred over the window. The pane moves like setup's
  (`usePaneMotion` in `StudySetupPane.tsx`: same slide, fades and bubble glide). No rail action.
- Opened from the progress line, people line or menu, it reads the grid once (`fetchSharedProgress`),
  like the phone route's visit; landing on it uses the collection sync's read. Pull to refresh is the
  collection's pull, back to the Library when you were removed. Loading, Couldn't load and Couldn't
  refresh are the phone's.
- The phone's Details page on a wide window (an unfold with it open, a link) goes back to the
  collection under it, or replaces itself with the collection, which opens on Details.

## Study session

On `wide`, `app/session.tsx` lays out the Recite and Result boards; other classes get the phone screen.
Phone and wide render one tree, so a fold never remounts the mic. Layout only: chunks, masks, scoring
and recording are the phone's.

- Close is a `GlassButton` in a rail at the right edge (`railFrame` from `TabRail.tsx`: the session sits
  outside the tabs). The mic (`RecordingBar` `lowRight`) sits low right and its pill opens leftwards; Retry,
  Next and, once every chunk is done, Exit sit there too. `VerseCard` `large` draws 25/40 text and may
  take 60% of the height while reciting (30% beside a result). The cards stay at most 620 wide.
- One chunk: the reference and progress bar centred at the top, no sidebar.
- Two or more: `ChunkSidebar` (320, `cardAlt`): the reference, "Medium · 3 chunks", a row per chunk
  (done with its text and score, current, or not yet; "Revealed — this chunk won't count" on a peeked one)
  and Results once every chunk is done. A row tap scrolls the pages there, like a swipe, so it's off while
  a take runs. The glass sidebar button (`chunk-sidebar-toggle`) never moves; hidden, the reference and
  progress bar show. The slide runs on `Motion.paneMs` (`paneShift`), the pages fade out by 120 ms and
  back from 200 ms and change width at 190 ms, unseen.
- The finish (`SessionFinish` `wide`): 108 pt score, Done and Review chunks low right, 260 wide.
- A new page width (fold, rotation, sidebar) remounts the paging list on the current chunk
  (`key`, `initialScrollIndex`), and the list is always exactly one page wide.
- Dev builds: `/dev-session?s=<verse id>,<difficulty>,<chunk size>,<demo>` (`app/dev-session.tsx`,
  `hooks/use-session-demo.ts`). Demo words joined by `+`: `rec` draws the recording pill (looks only),
  `done<n>` recites n chunks through the real `processRecording` (finishing saves to the local database),
  `finish` shows the results page, `closed` hides the sidebar.

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

- Collection on wide, on the open Duo (shots; no taps there): `shot "/(tabs)/(library)/my-verses"
  --device duo --display inner` after `set_posture open` (list showing), and with `?collapsed=1` or
  `?collapsed=<verse id>` (dev builds only: list hidden, that verse selected): `seed-psalms?collapsed=1`
  (long), `my-verses?collapsed=seed-john-3-16` (due), and as reader-c `seed-psalm-23?collapsed=seed-35-1`
  (short, locked) and `seed-35-2` (engraved), each also `--dark`; Hide verses on for the lines. Setup
  straight: `/(tabs)/(library)/setup/seed-john-3-16`. Taps: `flow duo-collection --device ipad`
  (iPad Pro 13-inch (M5), turned on its side by the flow).
- Shared collection on wide, opened Duo (shots), as reader-c: `seed-romans-8`, `seed-sermon-mount`
  (ten columns, which fit here without scrolling) and `seed-philippians-4` (the header's 100% sweep),
  each also with `?collapsed=1` and `--dark`. Phone taps: `flow shared-progress shared-grid shared-emblems`.

- Study session on wide, opened Duo, as reader-a, each also `--dark`: `/dev-session?s=` with
  `seed-john-3-16,hard,1,rec` (Recite-One), `seed-psalm-23-1-3,medium,2,done1+rec` and `+closed`
  (Recite-C2), `seed-psalm-23-1-3,medium,1,done2` and `+closed` (Result-C3), `…,medium,2,done2`
  (Result-C2), `…,medium,2,done2+finish` (Finish-C2). Phone taps: `flow practice-session recording-controls`.

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
- 2026-11-23 · On wide, the collection's share and ⋯ sit as glass at the list's top right, and the rail's ⋯ is the verse's Reset Progress · the boards' rail ⋯ is setup's; collection actions belong to the list and hide with it.
- 2026-11-23 · The verse pane takes 51% of the width, not a fixed 444 pt · the boards' share, so an iPad's wider window keeps the proportions.
- 2026-11-23 · Beside the list, setup is the phone's column (preview, Difficulty, Your Progress, chunks, docked Start) · the boards' list-open column predates the restyle; one column for both.
- 2026-11-23 · The verse is cut to the lines that fit its pane, not the boards' 420 pt · the same rule on the Duo and a taller iPad.
- 2026-11-23 · Hide verses lines and Show verse use `primaryLight` and `tint` (boards: 0.16 bronze and #7d5c2e) · existing tokens with a dark mode.
- 2026-11-23 · A shared collection with others opens on Details on wide, and the people line opens Details too · the Shared-Collection board lands on the group, and its members are in that pane.
- 2026-11-23 · Opening Details on wide reads the grid once, as a phone visit does · the collection screen stays mounted across sessions, so without it other members' squares would be as old as the visit (F26).
- 2026-11-23 · Details on wide drops the board's "Details" heading for the name in a bubble, and its parts are white cards (stacked beside the list, two columns without it) · Q9: restyled to match the final setup; side-by-side cards are too narrow beside the list.
- 2026-11-23 · Dev builds take `collapsed=1|<verse id>` on a collection · shots of each board state without taps; one param, since the dev sign-in link loses a second.
- 2026-11-24 · The session's chunk sidebar is the tinted 320 pt one with card rows (Recite-C2, Result-C2, Finish-C2), not Result-C3's 340 pt list · three boards of four; one sidebar look.
- 2026-11-24 · A new page width remounts the session's list on its chunk, not `scrollToIndex` (F7) · the paging list's stale offset reached `onViewableItemsChanged` first, which would cancel a take and change the chunk; seen on the Duo, where an unfold landed between pages.
- 2026-11-24 · The result card keeps the phone's text size on wide; only the verse card grows to the boards' 25/40 · the chunk result stays close to today's (Q10).
