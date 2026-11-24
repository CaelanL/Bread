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
size and class (`app/dev-window.tsx`, dev builds against a local database only).

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
- `--dark` (any device) shoots in dark appearance and sets the simulator back afterwards.
- Maestro works on the closed Duo only. With it open, Maestro reads the screen in the outer
  display's coordinates (offset by −203, −273 and clipped to 466 × 678), so taps and scrolls miss.

## Browser checks

- `npm run sim -- shot /dev-window --device duo`: "466 × 678", "outer", and the glass buttons and
  bubble over bronze text. Opened (`set_posture open`), `--display inner`: "951 × 669", "wide";
  turned (`rotate left`): "669 × 951", "tall". Add `--dark` for the dark glass.

## Decisions

- 2026-11-23 · Classes use width and height, not width alone · the outer display gets the rail and the upright inner display doesn't, at nearly the same width.
- 2026-11-23 · Stay portrait-only · the probe on the Duo simulator showed the inner display already gets both orientations and the outer stays upright, so the native change (and its store build) isn't needed.
