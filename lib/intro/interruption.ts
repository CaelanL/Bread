// lib-ok: Preserves playback intent across transient native app inactivity without reopening or seeking.
export function createIntroInterruption(player: { pause(): Promise<unknown>; play(): Promise<unknown> }) {
  let playing = false;
  let inactive = false;
  let resume = false;
  let disposed = false;
  let pending = Promise.resolve();
  const enqueue = (operation: () => Promise<unknown>) => {
    pending = pending.catch(() => {}).then(async () => { if (!disposed) await operation(); });
    return pending;
  };
  const pause = async () => { if (inactive) await player.pause(); };
  return {
    onPlaying(value: boolean) {
      playing = value;
      if (value && inactive) { resume = true; return enqueue(pause); }
      return pending;
    },
    setInactive(value: boolean) {
      if (inactive === value) return pending;
      inactive = value;
      if (value) { resume = playing; return enqueue(pause); }
      const shouldResume = resume;
      return enqueue(async () => { if (!inactive && shouldResume) await player.play(); });
    },
    dispose() { disposed = true; },
  };
}
