import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { WAVEFORM_SAMPLES } from '@/components/study/Waveform';
import { VerseCard } from '@/components/study/VerseCard';
import { ResultCard, getScoreColor } from '@/components/study/ResultCard';
import { RecordingBar, RECORDING_BAR_HEIGHT } from '@/components/study/RecordingBar';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useStudySession } from '@/hooks/use-study-session';
import { formatVerseReference } from '@/lib/storage';
import {
  type Chunk,
  type Difficulty,
  type ResultsPageItem,
  type HideMode,
  isResultsPage,
  maskDisplayWords,
} from '@/lib/study-chunks';
import { getAuthToken } from '@/lib/api/client';
import { showErrorToast } from '@/lib/toast';
import {
  startLiveTranscription,
  base64ToUint8Array,
  type LiveTranscriptionSession,
} from '@/lib/transcription/live-session';
import {
  useAudioRecorder,
  AudioStudioModule,
  type AudioDataEvent,
} from '@siteed/audio-studio';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

type RecordingState = 'idle' | 'recording';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Recording cap: at 5 minutes the recording auto-submits exactly as if
// the user tapped done, so they still see how far they got.
const MAX_RECORDING_MS = 300_000;

export default function StudySessionScreen() {
  const { id, difficulty, chunkSize: chunkSizeParam } = useLocalSearchParams<{
    id: string;
    difficulty: Difficulty;
    chunkSize: string;
  }>();
  const chunkSize = parseInt(chunkSizeParam ?? '1', 10);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Session state hook
  const session = useStudySession({
    verseId: id ?? '',
    difficulty: difficulty ?? 'easy',
    chunkSize,
  });

  // Recording state (kept local due to animation coupling)
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcribing, setTranscribing] = useState(false);
  const [exitingChunks, setExitingChunks] = useState<Set<number>>(new Set());
  // Per-chunk visibility override driven by the header reveal/hide button.
  // Cosmetic only; scoring always uses chunk.text. Absence = mode default.
  const [hideModes, setHideModes] = useState<Map<number, HideMode>>(new Map());

  const { startRecording, stopRecording } = useAudioRecorder();
  // The hook's isRecording lags a render; teardown paths need a sync answer
  const recordingActiveRef = useRef(false);
  // Bumped by every teardown; a mic press whose startRecording resolves
  // under a stale generation was torn down mid-start and must not go live
  const recordingGenRef = useRef(0);
  const liveSessionRef = useRef<LiveTranscriptionSession | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bar levels live in a shared value so the waveform animates on the
  // UI thread without re-rendering this screen (10x/sec while recording)
  const waveformLevels = useSharedValue<number[]>(new Array(WAVEFORM_SAMPLES).fill(0));

  // Animation values
  const recordingTabY = useSharedValue(RECORDING_BAR_HEIGHT + 60);
  const spinnerRotation = useSharedValue(0);

  const recordingTabStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: recordingTabY.value }],
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinnerRotation.value}deg` }],
  }));

  // Spinner animation
  useEffect(() => {
    if (transcribing) {
      spinnerRotation.value = withRepeat(
        withTiming(360, { duration: 1000, easing: Easing.linear }),
        -1,
        false
      );
    } else {
      spinnerRotation.value = 0;
    }
  }, [transcribing]);

  // Warm the auth session so the first mic press doesn't pay a lazy
  // token refresh serially in front of the Soniox key mint
  useEffect(() => {
    getAuthToken().catch(() => {});
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      teardownRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearCapTimer = useCallback(() => {
    if (capTimerRef.current) {
      clearTimeout(capTimerRef.current);
      capTimerRef.current = null;
    }
  }, []);

  // Shared teardown for every non-submit exit: cancel, scroll-away,
  // unmount, failed start. Closes the live socket (stops billing),
  // invalidates any in-flight startRecording, and stops the recorder.
  const teardownRecording = useCallback((): Promise<unknown> => {
    recordingGenRef.current++;
    liveSessionRef.current?.abort();
    liveSessionRef.current = null;
    clearCapTimer();
    waveformLevels.value = new Array(WAVEFORM_SAMPLES).fill(0);
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false;
      return stopRecording().catch(() => {});
    }
    return Promise.resolve();
  }, [clearCapTimer, stopRecording]);

  const hideRecordingBar = useCallback((onComplete?: () => void) => {
    recordingTabY.value = withTiming(
      RECORDING_BAR_HEIGHT + 60,
      { duration: 250, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished && onComplete) {
          runOnJS(onComplete)();
        }
      }
    );
  }, []);

  const handleSubmit = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    recordingGenRef.current++;
    clearCapTimer();
    waveformLevels.value = new Array(WAVEFORM_SAMPLES).fill(0);

    const liveSession = liveSessionRef.current;
    liveSessionRef.current = null;

    if (!recordingActiveRef.current) {
      liveSession?.abort();
      setRecordingState('idle');
      return;
    }

    try {
      setTranscribing(true);

      recordingActiveRef.current = false;
      const recording = await stopRecording();
      const durationMs = recording.durationMs ?? 0;
      // Compressed (m4a) output is the batch-fallback upload, matching
      // the frozen process-recording contract; primary WAV is disabled
      const uri = recording.compression?.compressedFileUri ?? recording.fileUri;

      // A missing file only matters if there's no live transcript to
      // finalize — the live path never reads the file
      if (!uri && !liveSession) {
        throw new Error('No recording URI');
      }

      setRecordingState('idle');

      await session.processRecording(uri, durationMs, liveSession ?? undefined);

      // Hide bar after processing
      hideRecordingBar(() => setTranscribing(false));
    } catch (error) {
      // Covers failures before the hook took ownership (idempotent)
      liveSession?.abort();
      console.error('Recording submission failed:', error);
      hideRecordingBar(() => setTranscribing(false));
      Alert.alert('Error', `Recording failed: ${error}`);
      setRecordingState('idle');
    }
  }, [clearCapTimer, hideRecordingBar, session, stopRecording]);

  // Latest-closure ref for the cap timer: the timer arms at record-start
  // and fires up to 5 minutes later, so calling the captured handleSubmit
  // directly would submit with stale session state (retry/peek flags
  // committed after record-start would be missed).
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  // Waveform level computed from the PCM chunks directly (RMS → dBFS),
  // instead of the library's analysis events — enableProcessing would
  // make the hook dispatch a state update per 50ms event, re-rendering
  // this whole screen twice a tick. Four bars per 100ms chunk (25ms
  // windows) go straight into the shared value; no React render at all.
  const computeBarLevel = useCallback((pcm: Uint8Array, start: number, end: number) => {
    let sumSquares = 0;
    let count = 0;
    for (let i = start; i + 1 < end; i += 2) {
      let sample = pcm[i] | (pcm[i + 1] << 8);
      if (sample >= 0x8000) sample -= 0x10000;
      sumSquares += sample * sample;
      count++;
    }
    if (count === 0) return null;
    const rms = Math.sqrt(sumSquares / count) / 32768;
    const dB = 20 * Math.log10(Math.max(rms, 1e-6));
    const minDb = -26;
    const maxDb = -6;
    return Math.max(0, Math.min(1, (dB - minDb) / (maxDb - minDb)));
  }, []);

  const handleAudioStream = useCallback(async (event: AudioDataEvent) => {
    if (typeof event.data !== 'string') return;
    const pcm = base64ToUint8Array(event.data);
    liveSessionRef.current?.feedAudio(pcm);
    if (recordingActiveRef.current) {
      const quarter = (pcm.length >> 3) << 1; // even byte boundary
      const bars: number[] = [];
      for (let q = 0; q < 4; q++) {
        const start = q * quarter;
        const end = q === 3 ? pcm.length : (q + 1) * quarter;
        const level = computeBarLevel(pcm, start, end);
        if (level !== null) bars.push(level);
      }
      if (bars.length > 0) {
        waveformLevels.value = [...waveformLevels.value.slice(bars.length), ...bars];
      }
    }
  }, [computeBarLevel, waveformLevels]);

  const handleMicPress = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const { granted } = await AudioStudioModule.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Please allow microphone access to record.');
        return;
      }

      // Background live stream: PCM fed from the first callback is
      // buffered while the token mint + socket connect complete. Any
      // failure (kill switch, offline, drop) leaves the batch path to
      // score the file — never surfaced to the user.
      const chunkText = session.chunks[session.currentIndex]?.text;
      liveSessionRef.current?.abort();
      liveSessionRef.current = chunkText ? startLiveTranscription(chunkText) : null;

      const gen = recordingGenRef.current;
      await startRecording({
        sampleRate: 16000,
        channels: 1,
        encoding: 'pcm_16bit',
        interval: 100,
        // m4a for the batch-fallback upload (frozen contract); no WAV
        output: {
          primary: { enabled: false },
          compressed: { enabled: true, format: 'aac' },
        },
        ios: {
          audioSession: {
            category: 'PlayAndRecord',
            mode: 'Default',
            categoryOptions: ['DefaultToSpeaker', 'AllowBluetooth'],
          },
        },
        onAudioStream: handleAudioStream,
      });
      if (recordingGenRef.current !== gen) {
        // Torn down (scroll-away, unmount, cancel) while the native
        // start was in flight — don't leave the mic hot
        stopRecording().catch(() => {});
        return;
      }
      recordingActiveRef.current = true;

      capTimerRef.current = setTimeout(() => {
        capTimerRef.current = null;
        showErrorToast('5 minute limit reached — scoring what you recited.');
        handleSubmitRef.current();
      }, MAX_RECORDING_MS);

      // Show recording bar
      recordingTabY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });

      waveformLevels.value = new Array(WAVEFORM_SAMPLES).fill(0);

      setRecordingState('recording');
    } catch (error) {
      teardownRecording();
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  }, [session.chunks, session.currentIndex, startRecording, stopRecording, teardownRecording, handleAudioStream]);

  const handleCancel = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    hideRecordingBar();

    // Closes the socket (stops billing); the recitation is discarded
    // unscored, unstored — cancel stays a complete no-op. Awaited so an
    // immediate re-record can't overlap the stopping mic session.
    await teardownRecording();

    setRecordingState('idle');
  }, [hideRecordingBar, teardownRecording]);

  const handleRetry = useCallback((index: number) => {
    setExitingChunks((prev) => new Set([...prev, index]));
  }, []);

  const handleExitComplete = useCallback((index: number) => {
    setExitingChunks((prev) => {
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
    session.retryChunk(index);
    handleMicPress();
  }, [session, handleMicPress]);

  // Reveal/hide button. Easy cycles show → some → all → show (cosmetic).
  // Medium/Hard toggles reveal (show) ↔ original mask; the first reveal
  // taints the chunk (peekChunk) so it scores 0.
  const isEasy = (difficulty ?? 'easy') === 'easy';

  const handleToggleVisibility = useCallback((index: number) => {
    Haptics.selectionAsync();
    setHideModes((prev) => {
      const next = new Map(prev);
      const current = next.get(index);
      if (isEasy) {
        // show (no override) → some → all → show
        if (current === undefined) next.set(index, 'some');
        else if (current === 'some') next.set(index, 'all');
        else next.delete(index);
      } else {
        // Medium/Hard: reveal ↔ original mask
        if (current === 'show') next.delete(index);
        else next.set(index, 'show');
      }
      return next;
    });
    // Medium/Hard: revealing taints the chunk (one-way, sticky).
    if (!isEasy) {
      session.peekChunk(index);
    }
  }, [isEasy, session]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const index = viewableItems[0].index;
        if (index !== null && index !== session.currentIndex) {
          // Cancel any active recording when scrolling away
          teardownRecording();
          setRecordingState('idle');
          session.setCurrentIndex(index);
        }
      }
    },
    [session.currentIndex, session.setCurrentIndex, teardownRecording]
  );

  const viewabilityConfig = {
    itemVisiblePercentThreshold: 50,
  };

  const buttonBg = colors.primary;

  // Loading state
  if (session.loading) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  // Error state
  if (!session.verse || session.chunks.length === 0) {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.text }}>Something went wrong</Text>
      </View>
    );
  }

  const renderItem = ({ item, index }: { item: Chunk | ResultsPageItem; index: number }) => {
    // Results page
    if (isResultsPage(item)) {
      const passed = session.finalScore >= 90;

      return (
        <View style={[styles.chunkContainer, { width: SCREEN_WIDTH }]}>
          <View style={styles.resultsContent}>
            <Text style={[styles.resultsTitle, { color: colors.text }]}>Session Complete</Text>

            <View style={[styles.scoreCircle, { borderColor: passed ? colors.success : colors.error }]}>
              <Text style={[styles.scoreText, { color: passed ? colors.success : colors.error }]}>
                {session.finalScore}%
              </Text>
            </View>

            <Text style={[styles.scoreLabel, { color: colors.icon }]}>
              {passed ? 'Great job! You passed!' : 'Keep practicing!'}
            </Text>

            <View style={styles.resultsButtons}>
              <Pressable
                style={[styles.resultsButton, { backgroundColor: colors.cardAlt }]}
                onPress={session.viewResults}
              >
                <Text style={[styles.resultsButtonText, { color: colors.text }]}>View Results</Text>
              </Pressable>

              <Pressable
                style={[styles.resultsButton, { backgroundColor: buttonBg }]}
                onPress={session.done}
              >
                <Text style={[styles.resultsButtonText, { color: colors.white }]}>Done</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.controlsContainer} />
        </View>
      );
    }

    // Regular chunk
    const isCompleted = session.completedChunks.has(index);
    const isRetrying = session.retryingChunks.has(index);
    const isExiting = exitingChunks.has(index);
    const result = session.getChunkResult(index);
    const retryResult = session.getRetryResult(index);

    // When retrying, show mic instead of result. When retry result exists, show that.
    const showMic = (!isCompleted || isRetrying) && !retryResult;
    // Keep result card visible during exit animation
    const showResult = (isCompleted && !isRetrying) || isExiting;

    // Resolve the reveal/hide override for this chunk. Completion wins:
    // a finished chunk always shows its text, whatever the toggle said.
    const hideMode = hideModes.get(index);
    const isPeeked = session.peekedChunks.has(index);
    const peekResult = session.getPeekResult(index);
    // Effective display words + revealed flag. Absent override = the
    // chunk's original mask (preserves Medium's seeded 50% / Hard blanks).
    let displayChunk = item;
    let revealed = isCompleted && !isRetrying;
    let memoryPlaceholder = false;
    if (!revealed) {
      if (hideMode === 'show') {
        revealed = true;
      } else if (hideMode === 'some') {
        displayChunk = {
          ...item,
          // Vary the "some" parity per chunk (like medium) so chunks in a
          // session don't all blank the same words — verseNum is stable.
          displayWords: maskDisplayWords(item.displayWords, 'some', session.sessionSeed + item.verseNum),
        };
      } else if (hideMode === 'all') {
        // Easy "all hidden": Hard's recite-from-memory placeholder
        // instead of a wall of underscores.
        memoryPlaceholder = true;
      }
    }
    // Eye toggle lives on the card; hidden once the chunk completes
    // (the card is already revealed there).
    const wordsCurrentlyShown = isEasy ? hideMode === undefined : hideMode === 'show';

    // Build verse label
    const verseLabel =
      session.verse!.verseStart === session.verse!.verseEnd
        ? formatVerseReference(session.verse!)
        : item.verseNumEnd
        ? `Verses ${item.verseNum}-${item.verseNumEnd}`
        : `Verse ${item.verseNum}`;

    return (
      <View style={[styles.chunkContainer, { width: SCREEN_WIDTH }]}>
        <View style={styles.cardsArea}>
          {/* Score badge on top of verse card when completed. For a
              peeked chunk, show the real recited score (the scored 0
              lives only in the session total, explained on the card). */}
          {isCompleted && (isPeeked ? peekResult : result) && (() => {
            const badgeScore = (isPeeked ? peekResult! : result!).score;
            return (
              <View style={[styles.scoreBadgeRow]}>
                <View style={[styles.scoreBadgeInline, {
                  backgroundColor: `${getScoreColor(badgeScore)}20`,
                }]}>
                  <Text style={[styles.scoreBadgeInlineText, {
                    color: getScoreColor(badgeScore),
                  }]}>
                    Score: {badgeScore}%
                  </Text>
                </View>
              </View>
            );
          })()}

          <VerseCard
            chunk={displayChunk}
            difficulty={difficulty ?? 'easy'}
            verseLabel={verseLabel}
            revealed={revealed}
            revealFast={hideMode === 'show'}
            memoryPlaceholder={memoryPlaceholder}
            visibilityIcon={wordsCurrentlyShown ? 'eye' : 'eye.slash'}
            onToggleVisibility={
              isCompleted ? undefined : () => handleToggleVisibility(index)
            }
          />

          {/* Result card. Priority: retry > peek > original. A peeked
              chunk shows the REAL recited score (peekResult) with a
              "won't count" banner — the scored 0 lives only in
              chunkResults and feeds the session total. */}
          {showResult && retryResult && (
            <ResultCard
              score={retryResult.score}
              alignment={retryResult.alignment}
              transcription={retryResult.transcription}
              isRetry
              exiting={isExiting}
              onExitComplete={() => handleExitComplete(index)}
            />
          )}
          {showResult && !retryResult && isPeeked && peekResult && (
            <ResultCard
              score={peekResult.score}
              alignment={peekResult.alignment}
              transcription={peekResult.transcription}
              isPeeked
              exiting={isExiting}
              onExitComplete={() => handleExitComplete(index)}
            />
          )}
          {showResult && !retryResult && !isPeeked && result && (
            <ResultCard
              score={result.score}
              alignment={result.alignment}
              transcription={result.transcription}
              exiting={isExiting}
              onExitComplete={() => handleExitComplete(index)}
            />
          )}
        </View>

        <View style={styles.controlsContainer}>
          {/* Mic button — first attempt or retry */}
          {recordingState === 'idle' &&
            !transcribing &&
            showMic &&
            session.currentIndex === index && (
              <Pressable
                style={[styles.micButton, { backgroundColor: buttonBg }]}
                onPress={handleMicPress}
              >
                <IconSymbol name="mic.fill" size={32} color={colors.white} />
              </Pressable>
            )}

          {/* Next + Retry buttons. Retry is hidden when there's only
              one chunk — in that case the chunk's score *is* the
              session score, but retry doesn't update it (chunkResults
              is the source of truth, retryResults is display-only),
              so showing it would be misleading: user would retry,
              see a higher score, and the saved progress would still
              reflect the original attempt. */}
          {recordingState === 'idle' &&
            !transcribing &&
            isCompleted &&
            !isRetrying &&
            !isExiting &&
            session.currentIndex === index && (
              <View style={styles.controlsRow}>
                {session.chunks.length > 1 && (
                  <Pressable
                    style={[styles.retryButton, { backgroundColor: colors.cardAlt }]}
                    onPress={() => handleRetry(index)}
                  >
                    <IconSymbol name="arrow.counterclockwise" size={22} color={colors.text} />
                  </Pressable>
                )}
                <Pressable
                  style={[styles.nextButton, { backgroundColor: buttonBg }]}
                  onPress={session.goToNext}
                >
                  <Text style={styles.nextButtonText}>
                    {session.allChunksCompleted ? 'See Results' : 'Next'}
                  </Text>
                  <IconSymbol name="arrow.right" size={20} color={colors.white} />
                </Pressable>
              </View>
            )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={formatVerseReference(session.verse)}
        showBack={false}
        leftButton={{
          icon: 'xmark',
          onPress: () => {
            // Save progress (if any) and exit
            session.saveAndExit();
          },
        }}
      />

      {/* Progress Bar */}
      <View style={[styles.progressContainer, { backgroundColor: colors.cardAlt }]}>
        {session.chunks.map((_, index) => (
          <View
            key={index}
            style={[
              styles.progressSegment,
              {
                backgroundColor: session.completedChunks.has(index)
                  ? colors.success
                  : index === session.currentIndex
                  ? buttonBg
                  : 'transparent',
              },
            ]}
          />
        ))}
      </View>

      {/* Swipeable Chunks */}
      <FlatList
        ref={session.flatListRef}
        data={session.listData}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={(recordingState === 'idle' && !transcribing) || session.showResults}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      {/* Recording Bar */}
      <RecordingBar
        isProcessing={transcribing}
        waveformLevels={waveformLevels}
        animatedStyle={recordingTabStyle}
        spinnerStyle={spinnerStyle}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressContainer: {
    flexDirection: 'row',
    height: 4,
    marginHorizontal: 20,
    marginTop: 8,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressSegment: {
    flex: 1,
    marginHorizontal: 1,
    borderRadius: 2,
  },
  chunkContainer: {
    flex: 1,
    padding: 16,
  },
  cardsArea: {
    flex: 1,
    justifyContent: 'center',
    gap: 12,
  },
  controlsContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 20,
    alignItems: 'center',
    minHeight: 132,
  },
  micButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  retryButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 28,
    gap: 8,
  },
  nextButtonText: {
    color: '#fff', // Always white on colored button
    fontSize: 17,
    fontWeight: '600',
  },
  scoreBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 6,
  },
  scoreBadgeInline: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  scoreBadgeInlineText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resultsContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  resultsTitle: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  scoreCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 42,
    fontWeight: 'bold',
  },
  scoreLabel: {
    fontSize: 18,
  },
  resultsButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  resultsButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  resultsButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
