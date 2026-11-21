// lib-ok: Stores scored and display results for each study chunk and selects its review controls.
import type { RecordingState } from './recording-controls';
import type { ChunkResult, RecordingScore } from './score-recording';

interface ChunkReview {
  scored: ChunkResult;
  peek?: ChunkResult;
  retry?: ChunkResult;
}

export type ChunkResults = ReadonlyMap<number, ChunkReview>;

export function saveChunkResult(
  results: ChunkResults,
  index: number,
  result: RecordingScore,
  isPeeked: boolean,
): ChunkResults {
  if (result.scored) {
    const peek = isPeeked ? result.display : undefined;
    return new Map(results).set(index, { scored: result.scored, peek });
  }
  const original = results.get(index);
  return original ? new Map(results).set(index, { ...original, retry: result.display }) : results;
}

export function scoredAlignments(results: ChunkResults) {
  return new Map(Array.from(results, ([index, result]) => [index, result.scored.alignment]));
}

export function getChunkReview(
  results: ChunkResults,
  index: number,
  currentIndex: number,
  chunkCount: number,
  recording: RecordingState,
) {
  const result = results.get(index);
  const isCompleted = !!result;
  const isRetrying = recording.phase !== 'idle' && recording.phase !== 'stopping' &&
    recording.index === index && recording.isRetry;
  const canContinue = isCompleted && recording.phase === 'idle' && index === currentIndex;
  return {
    isCompleted,
    isRetrying,
    originalDisplay: result?.peek ?? result?.scored,
    display: isRetrying ? undefined : result?.retry ?? result?.peek ?? result?.scored,
    isRetryResult: !!result?.retry,
    isPeeked: !!result?.peek,
    canContinue,
    canRetry: canContinue && chunkCount > 1,
  };
}
