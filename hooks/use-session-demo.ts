import { useEffect, useRef } from 'react';
import type { SharedValue } from 'react-native-reanimated';

import type { useStudySession } from '@/hooks/use-study-session';
import { canDevSignIn } from '@/lib/auth/dev-sign-in';
import type { LiveTranscriptionSession } from '@/lib/transcription/live-session';

/**
 * Dev only: puts a session in a board's state without taps, for `npm run sim -- shot` on the open
 * Duo (which Maestro can't tap). `demo` holds words joined by `+`: `rec` draws the recording pill
 * (looks only, nothing records), `done<n>` recites the first n chunks through the real
 * `processRecording` (the first word for word, later ones missing a word) and shows chunk n's result
 * (with `rec`, the chunk after it),
 * `finish` then shows the results page, `closed` starts with the chunk sidebar hidden. Reached through
 * `/dev-session`. Finishing every chunk saves the score to the local database, like a real session.
 */
export function useSessionDemo(
  session: ReturnType<typeof useStudySession>,
  demo: string | undefined,
  waveformLevels: SharedValue<number[]>,
) {
  // Same guard as the route: dev builds against a local database only, since `done` saves scores.
  const allowed = canDevSignIn(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL);
  const words = allowed && demo ? demo.split(/[+ ]/) : [];
  const done = Number(words.find((w) => w.startsWith('done'))?.slice(4) ?? 0);
  const finish = words.includes('finish');
  const recording = words.includes('rec');
  const sent = useRef(-1);
  const shown = useRef(false);
  const { chunks, completedChunks, loading, processRecording, flatListRef, setCurrentIndex } = session;
  const target = Math.min(done, chunks.length);

  useEffect(() => {
    if (!recording) return;
    waveformLevels.set((levels) => levels.map((_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.5) * Math.sin(i * 0.13))));
  }, [recording, waveformLevels]);

  useEffect(() => {
    if (loading || target === 0) return;
    const index = completedChunks.size;
    if (index >= target) {
      if (shown.current) return;
      shown.current = true;
      const page = finish && target === chunks.length ? chunks.length : recording ? target : target - 1;
      setCurrentIndex(page);
      flatListRef.current?.scrollToIndex({ index: page, animated: false });
      return;
    }
    if (sent.current === index) return;
    sent.current = index;
    const text = chunks[index].text.split(/\s+/);
    const spoken = index === 0 ? text : text.filter((_, i) => i !== Math.floor(text.length / 2));
    const liveSession: LiveTranscriptionSession = {
      state: 'closed',
      model: 'demo',
      feedAudio() {},
      finish: async () => spoken.join(' '),
      abort() {},
    };
    void processRecording({
      index,
      isRetry: false,
      recording: { fileUri: '', durationMs: 4000 },
      liveSession,
      isCurrent: () => true,
    }, false);
  }, [chunks, completedChunks, finish, flatListRef, loading, processRecording, recording, setCurrentIndex, target]);

  return { recording, closed: words.includes('closed') };
}
