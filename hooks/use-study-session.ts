import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FlatList } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type SavedVerse, type Difficulty as StorageDifficulty } from '@/lib/storage';
import { findVerse, useAppStore, useHydrated } from '@/lib/store';
import { getVerseText } from '@/lib/api/bible';
import {
  type Chunk,
  type Difficulty,
  type ResultsPageItem,
  parseVerseIntoChunks,
  calculateFinalScore,
  calculatePartialScore,
  createResultsPageItem,
} from '@/lib/study-chunks';
import { processRecording as processRecordingApi, logSessionAttempt } from '@/lib/api';
import { showErrorToast } from '@/lib/toast';
import { getChunkReview, saveChunkResult, scoredAlignments, type ChunkResults } from '@/lib/transcription/chunk-results';
import type { RecordingState, RecordingSubmission } from '@/lib/transcription/recording-controls';
import { scoreRecording } from '@/lib/transcription/score-recording';

interface UseStudySessionOptions {
  verseId: string;
  difficulty: Difficulty;
  chunkSize: number;
}

interface UseStudySessionReturn {
  // Data
  verse: SavedVerse | null;
  chunks: Chunk[];
  loading: boolean;
  /** Why the session couldn't open, shown with a way back. */
  loadError: string | null;
  currentIndex: number;
  completedChunks: Set<number>;
  showResults: boolean;

  getChunkReview: (index: number, recording: RecordingState) => ReturnType<typeof getChunkReview>;

  // Peek (reveal) state — a peeked chunk scores 0 (Medium/Hard only)
  getPeekedChunks: () => ReadonlySet<number>;
  peekChunk: (index: number) => void;
  sessionSeed: number;

  // Computed
  allChunksCompleted: boolean;
  listData: (Chunk | ResultsPageItem)[];
  finalScore: number;

  // Actions
  setCurrentIndex: (index: number) => void;
  goToNext: () => void;
  goToResults: () => void;
  viewResults: () => void;
  done: () => void;
  saveAndExit: () => void;

  // Recording result handler
  processRecording: (submission: RecordingSubmission, isPeeked: boolean) => Promise<void>;

  // Refs
  flatListRef: React.RefObject<FlatList | null>;
}

export function useStudySession({
  verseId,
  difficulty,
  chunkSize,
}: UseStudySessionOptions): UseStudySessionReturn {
  const [verse, setVerse] = useState<SavedVerse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [chunkResults, setChunkResults] = useState<ChunkResults>(new Map());
  const [showResults, setShowResults] = useState(false);
  const [totalRecordingDurationMs, setTotalRecordingDurationMs] = useState(0);
  const [sessionSeed, setSessionSeed] = useState(0);

  const flatListRef = useRef<FlatList>(null);
  const peekedChunksRef = useRef<ReadonlySet<number>>(new Set());
  const savedAttemptRef = useRef(false);

  const hydrated = useHydrated();

  // Load once the store has the library. The store, not a refetch, so a mastered verse
  // removed from every collection opens here just as it does on the setup screen.
  useEffect(() => {
    if (!hydrated) return;
    async function loadVerse() {
      const found = findVerse(useAppStore.getState(), verseId);
      if (!found) {
        setLoadError('This verse is no longer in your library.');
        setLoading(false);
        return;
      }
      try {
        let verseWithText = found;
        if (!found.text || !found.verses) {
          const { text, verses: keyedVerses } = await getVerseText(found);
          verseWithText = { ...found, text, verses: keyedVerses };
        }
        setVerse(verseWithText);
        const seed = Math.floor(Math.random() * 2);
        setSessionSeed(seed);
        setChunks(parseVerseIntoChunks(verseWithText, difficulty, chunkSize, seed));
      } catch (e) {
        console.error('[STUDY] Failed to load verse text:', e);
        setLoadError("Couldn't load this verse. Check your connection and try again.");
      }
      setLoading(false);
    }
    loadVerse();
  }, [hydrated, verseId, difficulty, chunkSize]);

  // Computed values
  const completedChunks = useMemo(() => new Set(chunkResults.keys()), [chunkResults]);
  const allChunksCompleted = completedChunks.size === chunks.length && chunks.length > 0;

  const listData: (Chunk | ResultsPageItem)[] = allChunksCompleted
    ? [...chunks, createResultsPageItem()]
    : chunks;

  const finalScore = calculateFinalScore(scoredAlignments(chunkResults));
  const readChunkReview = (index: number, recording: RecordingState) =>
    getChunkReview(chunkResults, index, currentIndex, chunks.length, recording);

  const getPeekedChunks = useCallback(() => peekedChunksRef.current, []);

  // Replace the set so submit can retain the exact reveal state at the tap.
  const peekChunk = useCallback((index: number) => {
    peekedChunksRef.current = new Set([...peekedChunksRef.current, index]);
  }, []);

  const processRecording = useCallback(async (
    { index, isRetry, recording, liveSession, isCurrent }: RecordingSubmission,
    isPeeked: boolean
  ) => {
    const text = chunks[index].text;
    const durationMs = recording.durationMs ?? 0;
    const uri = recording.compression?.compressedFileUri ?? recording.fileUri;

    const result = await scoreRecording({
      text,
      isRetry,
      isPeeked,
      liveSession,
      isCurrent,
      async transcribeFile() {
        if (!uri) throw new Error('No recording URI');
        return (await processRecordingApi(uri, durationMs, text)).cleanedTranscription;
      },
    });
    if (!result || !isCurrent()) return;

    // Count only recitations that produced a transcript and were kept.
    setTotalRecordingDurationMs((prev) => prev + durationMs);

    const nextResults = saveChunkResult(chunkResults, index, result, isPeeked);
    setChunkResults(nextResults);
    if (result.scored && !isPeeked && result.display.score >= 90 && process.env.EXPO_OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    if (result.scored && nextResults.size === chunks.length && !savedAttemptRef.current) {
      savedAttemptRef.current = true;
      const finalScoreValue = calculateFinalScore(scoredAlignments(nextResults));

      // Update progress in Zustand store (writes to Supabase + updates
      // local state). Fire-and-forget like the saveAndExit and
      // logSessionAttempt call sites — awaiting here held the spinner
      // through a full DB round-trip before showing the final score.
      if (verseId && difficulty && verse) {
        useAppStore.getState().updateVerseProgress(verseId, difficulty as StorageDifficulty, finalScoreValue, true)
          .catch(e => {
            console.error('[STUDY] Failed to update progress:', e);
            showErrorToast('Failed to save your progress.');
          });

        // Log session attempt for analytics (fire-and-forget, don't block UI)
        const sessionDurationMs = totalRecordingDurationMs + durationMs;
        const wordCount = verse.text ? verse.text.split(/\s+/).filter(Boolean).length : undefined;
        logSessionAttempt({
          book: verse.book,
          chapter: verse.chapter,
          verseStart: verse.verseStart,
          verseEnd: verse.verseEnd,
          version: verse.version,
          difficulty,
          chunkSize,
          accuracy: finalScoreValue,
          recordingDurationMs: sessionDurationMs,
          wordCount,
        }).catch(e => console.error('[STUDY] Failed to log attempt:', e));
      }

      setShowResults(true);
    }
  }, [chunks, chunkResults, verseId, difficulty, verse, chunkSize, totalRecordingDurationMs]);

  // Navigation actions
  const goToNext = useCallback(() => {
    // Find next incomplete chunk
    for (let i = 0; i < chunks.length; i++) {
      if (!completedChunks.has(i)) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setCurrentIndex(i);
        flatListRef.current?.scrollToIndex({ index: i, animated: true });
        return;
      }
    }
    // All done - go to results
    setShowResults(true);
    flatListRef.current?.scrollToIndex({ index: chunks.length, animated: true });
  }, [chunks, completedChunks]);

  const goToResults = useCallback(() => {
    setShowResults(true);
    flatListRef.current?.scrollToIndex({ index: chunks.length, animated: true });
  }, [chunks.length]);

  const viewResults = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    flatListRef.current?.scrollToIndex({ index: 0, animated: true });
    setCurrentIndex(0);
  }, []);

  const done = useCallback(() => {
    router.back();
  }, []);

  const saveAndExit = useCallback(() => {
    // Only save if at least one chunk completed AND not already fully completed
    // (full completion already saves in processRecording)
    if (!savedAttemptRef.current && completedChunks.size > 0 && !allChunksCompleted && verse && verseId && difficulty) {
      savedAttemptRef.current = true;
      // Calculate partial score (treats uncompleted chunks as missing)
      const partialScore = calculatePartialScore(chunks, completedChunks, scoredAlignments(chunkResults));

      // Fire-and-forget: the Supabase round-trip must not block dismissal
      // (awaiting it here froze the X button for the full network latency).
      // Errors were already non-blocking, so visibility is unchanged.
      useAppStore
        .getState()
        .updateVerseProgress(verseId, difficulty as StorageDifficulty, partialScore)
        .catch((e) => console.error('[STUDY] Failed to update progress:', e));

      // Log session attempt (fire-and-forget)
      const wordCount = verse.text ? verse.text.split(/\s+/).filter(Boolean).length : undefined;
      logSessionAttempt({
        book: verse.book,
        chapter: verse.chapter,
        verseStart: verse.verseStart,
        verseEnd: verse.verseEnd,
        version: verse.version,
        difficulty,
        chunkSize,
        accuracy: partialScore,
        recordingDurationMs: totalRecordingDurationMs,
        wordCount,
      }).catch(e => console.error('[STUDY] Failed to log attempt:', e));
    }

    router.back();
  }, [completedChunks, allChunksCompleted, verse, verseId, difficulty, chunks, chunkResults, chunkSize, totalRecordingDurationMs]);

  return {
    verse,
    chunks,
    loading,
    loadError,
    currentIndex,
    completedChunks,
    showResults,
    getChunkReview: readChunkReview,
    getPeekedChunks,
    peekChunk,
    sessionSeed,
    allChunksCompleted,
    listData,
    finalScore,
    setCurrentIndex,
    goToNext,
    goToResults,
    viewResults,
    done,
    saveAndExit,
    processRecording,
    flatListRef,
  };
}
