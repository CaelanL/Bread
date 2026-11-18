// lib-ok: Shares the recording seam's transcript selection and score split with its tests.
import { alignTranscription, buildAllMissingAlignment } from '@/lib/align';
import { calculateChunkScore, type AlignmentWord } from '@/lib/study-chunks';
import type { LiveTranscriptionSession } from './live-session';

// Measured finalize latency is ~70–90ms. The file takes over if it stalls.
const FINALIZE_TIMEOUT_MS = 1500;

/** How a transcript was made, kept for grading reports. */
export interface RecordingInfo {
  path: 'live' | 'upload';
  liveFailure?: string;
  model?: string;
  durationMs: number;
}

export interface ChunkResult {
  score: number;
  transcription: string;
  alignment: AlignmentWord[];
  recording?: RecordingInfo;
}

export interface RecordingScore {
  display: ChunkResult;
  scored?: ChunkResult;
}

interface ScoreRecordingOptions {
  text: string;
  durationMs: number;
  isRetry: boolean;
  isPeeked: boolean;
  isCurrent(): boolean;
  liveSession: LiveTranscriptionSession;
  transcribeFile(): Promise<{ transcription: string; model?: string }>;
}

export async function scoreRecording({
  text,
  durationMs,
  isRetry,
  isPeeked,
  isCurrent,
  liveSession,
  transcribeFile,
}: ScoreRecordingOptions): Promise<RecordingScore | undefined> {
  let liveFailure: string | undefined;
  const liveTranscript = await liveSession.finish(FINALIZE_TIMEOUT_MS).catch((e: unknown) => {
    liveFailure = liveSession.failure ?? (e instanceof Error ? e.message : String(e));
    return null;
  });
  liveSession.abort();
  if (!isCurrent()) return;

  let transcription: string;
  let recording: RecordingInfo;
  if (liveTranscript !== null) {
    transcription = liveTranscript;
    recording = { path: 'live', model: liveSession.model, durationMs };
  } else {
    const file = await transcribeFile();
    transcription = file.transcription;
    recording = { path: 'upload', liveFailure, model: file.model, durationMs };
  }
  if (!isCurrent()) return;

  const alignment = alignTranscription(text, transcription);
  const display = { score: calculateChunkScore(alignment), transcription, alignment, recording };
  if (isRetry) return { display };

  const scored = isPeeked
    ? { score: 0, transcription, alignment: buildAllMissingAlignment(text), recording }
    : display;
  return { display, scored };
}
