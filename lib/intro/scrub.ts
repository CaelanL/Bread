// lib-ok: Pure scrub-bar math for the intro player, testable without the native video view.
const clamp = (fraction: number) => (Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0);

export function playbackFraction(positionMillis: number, durationMillis: number) {
  return durationMillis > 0 ? clamp(positionMillis / durationMillis) : 0;
}

export function seekPosition(fraction: number, durationMillis: number) {
  return durationMillis > 0 ? Math.round(clamp(fraction) * durationMillis) : 0;
}

export function playbackClock(millis: number) {
  const seconds = Math.max(0, Math.floor(millis / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
