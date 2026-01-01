import { useState, useEffect, useCallback, useRef } from 'react';
import { FlatList } from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  getSavedVerses,
  type SavedVerse,
  type Difficulty as StorageDifficulty,
} from '@/lib/storage';
import { useAppStore } from '@/lib/store';
import { getVerseText } from '@/lib/api/bible';
import {
  type Chunk,
  type Difficulty,
  type AlignmentWord,
  type ResultsPageItem,
  parseVerseIntoChunks,
  calculateChunkScore,
  calculateFinalScore,
  createResultsPageItem,
} from '@/lib/study-chunks';
import { processRecording as processRecordingApi, logSessionAttempt } from '@/lib/api';
import { alignTranscription } from '@/lib/align';

interface ChunkResult {
  score: number;
  transcription: string;
  alignment: AlignmentWord[];
}

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
  currentIndex: number;
  completedChunks: Set<number>;
  showResults: boolean;

  // Results per chunk
  getChunkResult: (index: number) => ChunkResult | undefined;

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

  // Recording result handler
  processRecording: (uri: string, durationMs: number) => Promise<{
    score: number;
    alignment: AlignmentWord[];
    allDone: boolean;
  }>;

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
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedChunks, setCompletedChunks] = useState<Set<number>>(new Set());
  const [chunkResults, setChunkResults] = useState<Map<number, ChunkResult>>(new Map());
  const [showResults, setShowResults] = useState(false);
  const [totalRecordingDurationMs, setTotalRecordingDurationMs] = useState(0);

  const flatListRef = useRef<FlatList>(null);

  // Load verse on mount
  useEffect(() => {
    async function loadVerse() {
      const verses = await getSavedVerses();
      const found = verses.find((v) => v.id === verseId);
      if (found) {
        // Ensure we have the verse text (may need to fetch from cache/API)
        let verseWithText = found;
        if (!found.text) {
          const text = await getVerseText(found);
          verseWithText = { ...found, text };
        }
        setVerse(verseWithText);
        const parsedChunks = parseVerseIntoChunks(verseWithText, difficulty, chunkSize, Math.floor(Math.random() * 2));
        setChunks(parsedChunks);
      }
      setLoading(false);
    }
    loadVerse();
  }, [verseId, difficulty, chunkSize]);

  // Computed values
  const allChunksCompleted = completedChunks.size === chunks.length && chunks.length > 0;

  const listData: (Chunk | ResultsPageItem)[] = allChunksCompleted
    ? [...chunks, createResultsPageItem()]
    : chunks;

  const finalScore = calculateFinalScore(
    new Map(Array.from(chunkResults.entries()).map(([k, v]) => [k, v.alignment]))
  );

  // Get result for a specific chunk
  const getChunkResult = useCallback((index: number): ChunkResult | undefined => {
    return chunkResults.get(index);
  }, [chunkResults]);

  // Process a recording and update state
  const processRecording = useCallback(async (uri: string, durationMs: number) => {
    const currentChunk = chunks[currentIndex];
    const actualText = currentChunk.text;

    // Track recording duration
    setTotalRecordingDurationMs((prev) => prev + durationMs);

    // Process recording: transcribe + clean in one call (or two for longer recordings)
    const { cleanedTranscription } = await processRecordingApi(uri, durationMs, actualText);

    // Align locally (no API call needed)
    const alignment = alignTranscription(actualText, cleanedTranscription);

    // Calculate score
    const score = calculateChunkScore(alignment);

    // Store result
    setChunkResults((prev) => new Map(prev).set(currentIndex, {
      score,
      transcription: cleanedTranscription,
      alignment,
    }));

    // Mark as completed
    const newCompleted = new Set([...completedChunks, currentIndex]);
    setCompletedChunks(newCompleted);

    // Check if all done
    const allDone = newCompleted.size === chunks.length;

    if (allDone) {
      // Calculate final score from ALL alignments
      const allAlignments = new Map(
        Array.from(chunkResults.entries()).map(([k, v]) => [k, v.alignment])
      );
      allAlignments.set(currentIndex, alignment);
      const finalScoreValue = calculateFinalScore(allAlignments);

      // Update progress in Zustand store (writes to Supabase + updates local state)
      if (verseId && difficulty && verse) {
        try {
          await useAppStore.getState().updateVerseProgress(verseId, difficulty as StorageDifficulty, finalScoreValue);
        } catch (e) {
          console.error('[STUDY] Failed to update progress:', e);
        }

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

    return { score, alignment, allDone };
  }, [chunks, currentIndex, completedChunks, chunkResults, verseId, difficulty, verse, chunkSize, totalRecordingDurationMs]);

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

  return {
    verse,
    chunks,
    loading,
    currentIndex,
    completedChunks,
    showResults,
    getChunkResult,
    allChunksCompleted,
    listData,
    finalScore,
    setCurrentIndex,
    goToNext,
    goToResults,
    viewResults,
    done,
    processRecording,
    flatListRef,
  };
}
