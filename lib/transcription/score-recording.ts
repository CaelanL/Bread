// lib-ok: Shares the recording seam's transcript selection and score split with its tests.
import { alignTranscription, buildAllMissingAlignment } from '@/lib/align';
import { calculateChunkScore, type AlignmentWord } from '@/lib/study-chunks';
import type { LiveTranscriptionSession } from './live-session';

// Measured finalize latency is ~70–90ms. The file takes over if it stalls.
const FINALIZE_TIMEOUT_MS = 3000;

export interface ChunkResult {
  score: number;
  transcription: string;
  alignment: AlignmentWord[];
}

interface ScoreRecordingOptions {
  text: string;
  isRetry: boolean;
  isPeeked: boolean;
  isCurrent(): boolean;
  liveSession: LiveTranscriptionSession;
  transcribeFile(): Promise<string>;
}

export async function scoreRecording({
  text,
  isRetry,
  isPeeked,
  isCurrent,
  liveSession,
  transcribeFile,
}: ScoreRecordingOptions) {
  const liveTranscript = await liveSession.finish(FINALIZE_TIMEOUT_MS).catch(() => null);
  liveSession.abort();
  if (!isCurrent()) return;

  const transcription = liveTranscript ?? await transcribeFile();
  if (!isCurrent()) return;

  const alignment = alignTranscription(text, transcription);
  const display = { score: calculateChunkScore(alignment), transcription, alignment };
  if (isRetry) return { display };

  const scored = isPeeked
    ? { score: 0, transcription, alignment: buildAllMissingAlignment(text) }
    : display;
  return { display, scored };
}
