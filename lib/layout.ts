// lib-ok: pure window rules shared by screens and tests
/**
 * Layouts follow the window, never the device model. See docs/architecture/window-layouts.md.
 * - phone: today's screens (every iPhone, either way up)
 * - wide: the wide boards with the right-edge rail (open iPhone Duo on its side, iPad)
 * - outer: the closed Duo's outer display, with the rail
 * - tall: the open Duo upright, with the top bar and bottom tab pill
 */
export type WindowClass = 'phone' | 'wide' | 'outer' | 'tall';

/** A window whose shorter side is under this is a phone. 6 pt under the Duo's outer display (466). */
export const PHONE_SHORT_SIDE = 460;
/** From this width or height a window has room for the wide layouts. */
export const WIDE_SIDE = 800;

export function windowClass(width: number, height: number): WindowClass {
  if (Math.min(width, height) < PHONE_SHORT_SIDE) return 'phone';
  if (width >= WIDE_SIDE) return 'wide';
  return height < WIDE_SIDE ? 'outer' : 'tall';
}

const LINE_HEIGHT = 1.42;

/** The open Duo's verse pane: bigger type for shorter passages. */
export function verseFontSize(text: string): { fontSize: number; lineHeight: number } {
  const fontSize = text.length <= 90 ? 30 : text.length <= 170 ? 25 : 21;
  return { fontSize, lineHeight: Math.round(fontSize * LINE_HEIGHT) };
}

/**
 * Hide verses on the open Duo: one soft line shape per line the text would take, as percentages of
 * `lineWidth`. Full lines vary a little so they read as text; the last is shorter.
 */
export function hiddenLineWidths(length: number, lineWidth: number, fontSize: number): number[] {
  const perLine = lineWidth / (fontSize * 0.5);
  const count = Math.max(1, Math.ceil(length / perLine));
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? 38 + ((length * 7) % 40) : 100 - ((i * 13) % 9)));
}
