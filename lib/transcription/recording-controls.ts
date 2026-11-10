// lib-ok: Coordinates exclusive native recorder ownership independently of React rendering.
import type { LiveTranscriptionSession } from './live-session';

type ActivePhase = 'starting' | 'recording' | 'submitting' | 'stopping';

export type RecordingState =
  | { phase: 'idle' }
  | { phase: ActivePhase; index: number; isRetry: boolean };

interface RecordingFile {
  fileUri: string;
  durationMs?: number;
  compression?: { compressedFileUri: string };
}

interface Capture {
  requestPermission(): Promise<boolean>;
  start(): Promise<unknown>;
  stop(): Promise<RecordingFile>;
  openLive(): LiveTranscriptionSession;
}

export interface RecordingSubmission {
  index: number;
  isRetry: boolean;
  recording: RecordingFile;
  liveSession: LiveTranscriptionSession;
  isCurrent(): boolean;
}

interface Attempt {
  index: number;
  isRetry: boolean;
  phase: ActivePhase;
  capture: Capture;
  cancelled: boolean;
  liveSession?: LiveTranscriptionSession;
}

// Native capture is shared even if a new screen mounts while the old one stops.
let nativeOwner: Attempt | undefined;

export function createRecordingControls(onChange: (state: RecordingState) => void) {
  let current: Attempt | undefined;

  function transition(attempt: Attempt, phase: ActivePhase) {
    attempt.phase = phase;
    onChange({ phase, index: attempt.index, isRetry: attempt.isRetry });
  }

  function releaseNative(attempt: Attempt) {
    if (nativeOwner === attempt) nativeOwner = undefined;
  }

  function reset(attempt: Attempt) {
    if (current !== attempt) return;
    current = undefined;
    onChange({ phase: 'idle' });
  }

  return {
    async start(index: number, isRetry: boolean, capture: Capture) {
      if (current || nativeOwner) return;
      const attempt: Attempt = { index, isRetry, capture, phase: 'starting', cancelled: false };
      current = nativeOwner = attempt;
      transition(attempt, 'starting');

      try {
        const granted = await capture.requestPermission();
        if (attempt.cancelled) return;
        if (!granted) return 'denied';

        attempt.liveSession = capture.openLive();
        await capture.start();
        if (attempt.cancelled) {
          await capture.stop().catch(() => {});
          return;
        }
        transition(attempt, 'recording');
      } catch (error) {
        if (!attempt.cancelled) throw error;
      } finally {
        if (attempt.phase !== 'recording') {
          attempt.liveSession?.abort();
          releaseNative(attempt);
          reset(attempt);
        }
      }
    },

    async submit(process: (submission: RecordingSubmission) => Promise<void>) {
      const attempt = current;
      const liveSession = attempt?.liveSession;
      if (attempt?.phase !== 'recording' || !liveSession) return;
      const isCurrent = () => current === attempt && !attempt.cancelled;
      transition(attempt, 'submitting');

      try {
        const recording = await attempt.capture.stop();
        releaseNative(attempt);
        if (!isCurrent()) return;
        await process({ index: attempt.index, isRetry: attempt.isRetry, recording, liveSession, isCurrent });
      } catch (error) {
        if (isCurrent()) throw error;
      } finally {
        liveSession.abort();
        releaseNative(attempt);
        reset(attempt);
      }
    },

    async cancel() {
      const attempt = current;
      if (!attempt || attempt.cancelled) return;
      const wasRecording = attempt.phase === 'recording';
      attempt.cancelled = true;
      attempt.liveSession?.abort();
      if (nativeOwner !== attempt) {
        reset(attempt);
        return;
      }
      transition(attempt, 'stopping');
      if (wasRecording) {
        await attempt.capture.stop().catch(() => {});
        releaseNative(attempt);
        reset(attempt);
      }
    },

    canDiscard: () => current?.phase === 'starting' || current?.phase === 'recording',
    isRecording: () => current?.phase === 'recording',
    isSubmitting: () => current?.phase === 'submitting',

    feedAudio(pcm: Uint8Array) {
      if (!current?.cancelled) current?.liveSession?.feedAudio(pcm);
    },
  };
}
