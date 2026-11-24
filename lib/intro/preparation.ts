// lib-ok: Bounds native video preparation, which may never settle, over the hidden expo-video player.
import type { VideoPlayer, VideoPlayerStatus } from 'expo-video';

type Source = number | { uri: string };

export interface PreparableVideo {
  unloadAsync(): Promise<unknown>;
  loadAsync(source: Source, status: { shouldPlay: false; isMuted: boolean }): Promise<{ isLoaded: boolean }>;
}

// The hidden expo-video player behind preparation: loads paused, and is loaded once it is ready to play.
export function preparableVideo(player: Pick<VideoPlayer, 'replaceAsync' | 'status' | 'muted' | 'addListener'>): PreparableVideo {
  return {
    unloadAsync: () => player.replaceAsync(null),
    async loadAsync(source, { isMuted }) {
      player.muted = isMuted;
      await player.replaceAsync(source);
      const status = await new Promise<VideoPlayerStatus>((resolve) => {
        const settled = (value: VideoPlayerStatus) => value === 'readyToPlay' || value === 'error';
        const subscription = player.addListener('statusChange', ({ status: value }) => {
          if (settled(value)) { subscription.remove(); resolve(value); }
        });
        if (settled(player.status)) { subscription.remove(); resolve(player.status); }
      });
      return { isLoaded: status === 'readyToPlay' };
    },
  };
}

export async function prepareIntroVideo(
  video: PreparableVideo,
  source: string | number,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<void> {
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const current = () => !finished && !signal.aborted && isCurrent();
  const check = () => { if (!current()) throw new Error('Playback canceled.'); };
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Playback canceled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      if (current()) {
        finished = true;
        void video.unloadAsync().catch(() => {});
      }
      reject(new Error('Video preparation timed out.'));
    }, 15_000);
  });
  try {
    check();
    await Promise.race([
      (async () => {
        await video.unloadAsync();
        check();
        const status = await video.loadAsync(typeof source === 'number' ? source : { uri: source }, { shouldPlay: false, isMuted: true });
        check();
        if (!status.isLoaded) throw new Error('Media unavailable.');
      })(),
      interrupted,
    ]);
  } finally {
    finished = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
