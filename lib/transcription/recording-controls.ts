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

// The audio session kept warm by Bread's native patch: prepared when the study
// screen opens, kept active between chunks, released on leaving and backgrounding.
export interface WarmSession {
  hasPermission(): boolean;
  prepare(): Promise<unknown>;
  release(): Promise<unknown>;
}

interface RecorderModule {
  breadPatch?: unknown;
  prepareRecording(options: object): Promise<unknown>;
  releaseAudioSession(): Promise<unknown>;
}

// Only binaries with the patch keep the session warm. Elsewhere (old binaries,
// Android, web) there is nothing to prepare or release, and stop deactivates as before.
export function warmSession(module: RecorderModule, options: object, hasPermission: () => boolean): WarmSession | undefined {
  if (typeof module.breadPatch !== 'number') return undefined;
  return {
    hasPermission,
    prepare: () => module.prepareRecording(options),
    release: () => module.releaseAudioSession(),
  };
}

let preparing = false;
// A warm-up asked for during a prepare, run once that prepare settles: the
// prepare may be followed natively by a release sent while it was in flight.
let warmAfterPrepare: (() => void) | undefined;
// A release asked for while an attempt owns native runs after that attempt's
// stop: sent earlier, it would reach native first and leave the session active.
let pendingRelease: WarmSession | undefined;

function releaseNative(attempt: Attempt) {
  if (nativeOwner !== attempt) return;
  nativeOwner = undefined;
  const session = pendingRelease;
  pendingRelease = undefined;
  void session?.release().catch(() => {});
}

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

// A touch sends press-in, then press on release. VoiceOver activation sends both too.
export type PressSource = 'pressIn' | 'press';

export function createRecordingControls(onChange: (state: RecordingState) => void, warm?: WarmSession) {
  let current: Attempt | undefined;
  let pressedIn = false;
  // The abandoned-recordings sweep has run, so a prepared file can't be swept
  let opened = false;
  let away = false;

  function transition(attempt: Attempt, phase: ActivePhase) {
    attempt.phase = phase;
    onChange({ phase, index: attempt.index, isRetry: attempt.isRetry });
  }

  function reset(attempt: Attempt) {
    if (current !== attempt) return;
    current = undefined;
    onChange({ phase: 'idle' });
  }

  // Native prepare would show the permission prompt, so only with permission granted.
  // A tap during the prepare queues behind it natively and uses the prepared state.
  function warmUp() {
    if (!warm || !opened || away || !warm.hasPermission()) return;
    pendingRelease = undefined;
    if (nativeOwner) return;
    if (preparing) {
      warmAfterPrepare = warmUp;
      return;
    }
    preparing = true;
    void warm.prepare().catch(() => {}).finally(() => {
      preparing = false;
      const again = warmAfterPrepare;
      warmAfterPrepare = undefined;
      again?.();
    });
  }

  async function cancel() {
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
  }

  return {
    // Screen open: sweep leftovers first, then warm up once permission is known.
    async open(fs: RecordingFolders, permissionRead: Promise<unknown>) {
      away = false;
      await Promise.all([removeAbandonedRecordings(fs), permissionRead]);
      opened = true;
      warmUp();
    },

    // Backgrounding and leaving. A recording keeps the session until its stop.
    sleep() {
      away = true;
      if (!warm) return;
      if (nativeOwner) pendingRelease = warm;
      else void warm.release().catch(() => {});
    },

    wake() {
      if (!away) return;
      away = false;
      warmUp();
    },

    // A call, Siri or an AirPods disconnect paused native capture. Ends the
    // attempt with nothing scored; true only when this ended one.
    interrupt() {
      if (current?.cancelled || (current?.phase !== 'starting' && current?.phase !== 'recording')) return false;
      void cancel();
      return true;
    },

    async start(index: number, isRetry: boolean, capture: Capture, source: PressSource = 'press') {
      // Press-in already started this touch's attempt. Its press is ignored, so a
      // fast denial or failed start can't start a second attempt and alert twice.
      if (source === 'pressIn') pressedIn = true;
      else if (pressedIn) {
        pressedIn = false;
        return;
      }
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

    cancel,

    canDiscard: () => current?.phase === 'starting' || current?.phase === 'recording',
    isRecording: () => current?.phase === 'recording',
    isSubmitting: () => current?.phase === 'submitting',

    feedAudio(pcm: Uint8Array) {
      if (!current?.cancelled) current?.liveSession?.feedAudio(pcm);
    },
  };
}
