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
  hasPermission(): boolean;
  requestPermission(): Promise<boolean>;
  start(): Promise<unknown>;
  stop(): Promise<RecordingFile>;
  openLive(): LiveTranscriptionSession;
  remove(uri: string): Promise<unknown>;
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
// Attempts whose file may still be recorded or read; the sweep waits for none.
const unsettled = new Set<Attempt>();

async function removeRecording(attempt: Attempt, recording: RecordingFile | undefined) {
  unsettled.delete(attempt);
  const uris = new Set([recording?.fileUri, recording?.compression?.compressedFileUri]);
  await Promise.all([...uris].map((uri) => uri && attempt.capture.remove(uri).catch(() => {})));
}

interface RecordingFolders {
  documentDirectory: string | null;
  cacheDirectory: string | null;
  readDirectoryAsync(uri: string): Promise<string[]>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
}

const UUID = '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}';
const SWEEP_BATCH = 20;

// Leftovers from crashes and from builds that never deleted recordings:
// audio-studio's Documents/<UUID>.m4a and expo-av's Caches/AV/recording-<UUID>.m4a.
export async function removeAbandonedRecordings(fs: RecordingFolders) {
  const places = [
    { dir: fs.documentDirectory, name: new RegExp(`^${UUID}\\.m4a$`, 'i') },
    { dir: fs.cacheDirectory && `${fs.cacheDirectory}AV/`, name: new RegExp(`^recording-${UUID}\\.m4a$`, 'i') },
  ];
  for (const { dir, name } of places) {
    if (!dir) continue;
    const names = await fs.readDirectoryAsync(dir).catch((): string[] => []);
    const leftovers = names.filter((entry) => name.test(entry));
    for (let i = 0; i < leftovers.length; i += SWEEP_BATCH) {
      if (unsettled.size) return;
      await Promise.all(leftovers.slice(i, i + SWEEP_BATCH).map((entry) => (
        fs.deleteAsync(dir + entry, { idempotent: true }).catch(() => {})
      )));
    }
  }
}

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
      unsettled.add(attempt);
      let recording: RecordingFile | undefined;

      try {
        // With permission already granted, the native start leaves in the tap's
        // own tick, ahead of the 'starting' render.
        let started: Promise<unknown> | undefined;
        if (capture.hasPermission()) {
          started = capture.start();
          attempt.liveSession = capture.openLive();
        }
        transition(attempt, 'starting');
        if (!started) {
          const granted = await capture.requestPermission();
          if (attempt.cancelled) return;
          if (!granted) return 'denied';
          attempt.liveSession = capture.openLive();
          started = capture.start();
        }
        await started;
        if (attempt.cancelled) {
          recording = await capture.stop().catch(() => undefined);
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
          await removeRecording(attempt, recording);
        }
      }
    },

    async submit(process: (submission: RecordingSubmission) => Promise<void>) {
      const attempt = current;
      const liveSession = attempt?.liveSession;
      if (attempt?.phase !== 'recording' || !liveSession) return;
      const isCurrent = () => current === attempt && !attempt.cancelled;
      transition(attempt, 'submitting');
      let recording: RecordingFile | undefined;

      try {
        recording = await attempt.capture.stop();
        releaseNative(attempt);
        if (!isCurrent()) return;
        await process({ index: attempt.index, isRetry: attempt.isRetry, recording, liveSession, isCurrent });
      } catch (error) {
        if (isCurrent()) throw error;
      } finally {
        liveSession.abort();
        releaseNative(attempt);
        reset(attempt);
        await removeRecording(attempt, recording);
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
        const recording = await attempt.capture.stop().catch(() => undefined);
        releaseNative(attempt);
        reset(attempt);
        await removeRecording(attempt, recording);
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
