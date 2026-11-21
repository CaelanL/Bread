// lib-ok: Bounds native video preparation because expo-av may leave failed loads pending.
import type { Video } from 'expo-av';

export async function prepareIntroVideo(
  video: Pick<Video, 'unloadAsync' | 'loadAsync'>,
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
