# Wide study screens

How the study screens use a wider window: study setup (restyled on every iPhone too), the
collection, the shared collection and the study session. Window classes, the iPhone Duo simulator,
the tab rail and Home are in [window layouts](window-layouts.md).

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
- The collapse is one shared value running linearly over `Collapse.durationMs` (`Motion.paneMs`);
  every knob is in `Collapse` (`components/study/setup/collapse-motion.ts`): the curve (`Motion.easing`),
  the list slide's window (the pane's left edge and the bubble follow it), the list-open layout's fade
  out (first 120 ms), the hidden one's fade in (from 200 ms, rising 8 pt); only the resting layout stays
  mounted. Reduce Motion: everything fades and the panes jump halfway.
- Meanwhile the verse travels (`VerseTravel`): two copies, the preview's text in its 16 pt wrap and the
  pane's in its wrap, ride one path from the preview's spot (minus the column's scroll) to the pane's and
  grow from 16 pt to the pane's size (`grow`: a scale, or the font size itself), cross-fading over
  `crossFade` so nothing rewraps in flight. The copies sit above the list and show only between the
  ends; the real texts hide then. Hide verses: "Verse hidden" becomes the bars. Not under Reduce Motion
  or while the text loads. Selection and the collapse last while the screen is open, folds included. Phone and wide render
  the same tree, so a fold keeps the list's scroll and an open search.
- Setup opened straight on wide (a link) is the list-hidden layout with back only. Setup pushed from a
  collection on a phone goes back to it on an unfold (not while a session is open over it): a phone row
  tap selects too, so the collection shows that verse beside the list. A fold then shows the list.
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
  progress bar show. The slide and the pages' fades ride the collection's `Collapse` (`listShift`,
  `setupFadeOut`, `paneFadeIn`): the pages fade out by 120 ms and back from 200 ms and change width at
  190 ms, unseen.
- The finish (`SessionFinish` `wide`): 108 pt score, Done and Review chunks low right, 260 wide.
- A new page width (fold, rotation, sidebar) remounts the paging list on the current chunk
  (`key`, `initialScrollIndex`), and the list is always exactly one page wide.
- The session has its own `SafeAreaProvider`: as a full-screen modal it takes the app's root out of
  the window, and the root's insets stop following a turn or fold (the clock sat on the progress bar).
- Dev builds: `/dev-session?s=<verse id>,<difficulty>,<chunk size>,<demo>` (`app/dev-session.tsx`,
  `hooks/use-session-demo.ts`). Demo words joined by `+`: `rec` draws the recording pill (looks only),
  `done<n>` recites n chunks through the real `processRecording` (finishing saves to the local database),
  `finish` shows the results page, `closed` hides the sidebar.

## Browser checks

- Study setup on iPhone 16 Pro, light and `--dark`: `shot` the setup routes for `seed-psalm-23-1-3`,
  `seed-john-3-16` (review due) and `seed-romans-8-28` as reader-a, `seed-c-romans-8-1` (engraved),
  `seed-32-2` (locked) and `seed-32-4` (five verses) as reader-c. Taps: `flow setup-iphone`; Hide
  verses: `flow hide-verses`.

- Collection on wide, on the open Duo (shots; no taps there): `shot "/(tabs)/(library)/my-verses"
  --device duo --display inner` after `set_posture open` (list showing), and with `?collapsed=1` or
  `?collapsed=<verse id>` (dev builds only: list hidden, that verse selected): `seed-psalms?collapsed=1`
  (long), `my-verses?collapsed=seed-john-3-16` (due), and as reader-c `seed-psalm-23?collapsed=seed-35-1`
  (short, locked) and `seed-35-2` (engraved), each also `--dark`; Hide verses on for the lines. The
  collapse on video: `?loop=1|<verse id>[,<slow-down>]` (dev builds on the local database) collapses and
  reopens every couple of seconds; record with `xcrun simctl io <duo udid> recordVideo --display=3`. Setup
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

- 2026-11-23 · iPhone setup keeps today's order (preview, Difficulty, Your Progress, Verses per chunk); only the look follows the Duo boards · Caelan: "Yes, all leans" (O4); the restyle shouldn't move anything a reader knows.
- 2026-11-23 · Chunk size keeps today's sheet, restyled, not a native menu · a native menu needs `@expo/ui`, a native change, and this feature ships over the air (O2).
- 2026-11-23 · On the phone, back and ⋯ stay plain bar icons; only the reference is glass · the bar has no surface on every other screen, and the boards' glass buttons belong to the wide layouts.
- 2026-11-23 · The boards' deep bronze (#8f6a3a: Review now callout, tagline, selected All) is `tint`/`primary`, and the selected difficulty is the raised thumb, not solid bronze · tokens with a dark mode, and Q17 keeps today's bronze.
- 2026-11-23 · The preview card drops its reference pill · the bubble already names the verse.
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
- 2026-11-24 · The collapse's verse is two cross-fading copies scaled along one path, not one text with an animated font size · one text rewraps every frame; `grow: 'fontSize'` keeps each wrap and is there to compare (Q23).
- 2026-11-24 · The collapse's numbers, as Caelan accepted them unchanged after the slow-motion videos (Q23): 380 ms (`Motion.paneMs`) on Bread's curve [0.2, 0, 0, 1]; the list slide and the verse's move span the whole timeline; the cross-fade runs over 5–35% of it; the verse grows by `scale`; the list-open layout fades out over the first 120 ms and the hidden one fades in from 200 ms, rising 8 pt · a cross-fade over [0.1, 0.5] showed both wraps for about 100 ms, since the curve does about two thirds of the move in its first 30%; every number lives in `Collapse` (`collapse-motion.ts`).
