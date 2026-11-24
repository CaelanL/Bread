import { Motion } from '@/constants/theme';
import { Easing } from 'react-native-reanimated';

/**
 * Every knob of a collection's collapse on a wide window (the verse list sliding out, the setup
 * widening and the verse travelling into its pane), in one place for tuning. The session's chunk
 * sidebar rides the same slide and fade windows. One timeline runs
 * linearly from the tap (0) to the end (1) over `durationMs`; windows are [start, end] shares of it,
 * so changing the duration keeps their proportions. Reopening plays the same timeline backwards.
 */
export const Collapse = {
  /** The whole collapse, in ms. */
  durationMs: Motion.paneMs,
  /** The curve every moving part rides (cubic-bezier points). Bread's; the boards drew [0.32, 0.72, 0, 1]. */
  curve: Motion.easing as readonly [number, number, number, number],
  /** When the list slides out and the setup widens. */
  listSlide: [0, 1],
  /** When the verse moves and grows from the preview card into the pane. */
  textMove: [0, 1],
  /** When the preview's small text fades out while the pane's big text fades in (linear, so never both at full). */
  crossFade: [0.05, 0.35],
  /** How the verse grows: 'scale' draws each text at its own size and scales it; 'fontSize' animates the size itself (crisp, lays out every frame). */
  grow: 'scale' as 'scale' | 'fontSize',
  /** The setup column beside the list fades out over this window. */
  setupFadeOut: [0, 120 / Motion.paneMs],
  /** The list-hidden layout (tinted pane, right column) fades in over this window, rising `paneRise` pt. */
  paneFadeIn: [200 / Motion.paneMs, 1],
  paneRise: 8,
} as const;

const ease = Easing.bezierFn(...Collapse.curve);

/** Progress through `window` at timeline `t`, 0 before it and 1 after, on the curve. */
export function phase(t: number, window: readonly [number, number]) {
  'worklet';
  return ease(Math.min(1, Math.max(0, (t - window[0]) / (window[1] - window[0]))));
}

/** Linear progress through `window` at timeline `t` (fades). */
export function linear(t: number, window: readonly [number, number]) {
  'worklet';
  return Math.min(1, Math.max(0, (t - window[0]) / (window[1] - window[0])));
}

/** How far the list has slid out at `t`. Under Reduce Motion it jumps halfway, while both layouts are faded out. */
export function listShift(t: number, reduced: boolean) {
  'worklet';
  if (reduced) return t < 0.5 ? 0 : 1;
  return phase(t, Collapse.listSlide);
}
