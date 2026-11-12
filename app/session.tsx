import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { WAVEFORM_SAMPLES } from '@/components/study/Waveform';
import { VerseCard } from '@/components/study/VerseCard';
import { ResultCard, getScoreColor } from '@/components/study/ResultCard';
import { RecordingBar } from '@/components/study/RecordingBar';
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
} from '@/lib/transcription/live-session';
import { createRecordingControls, type RecordingState } from '@/lib/transcription/recording-controls';
import {
  useAudioRecorder,
  AudioStudioModule,
  type AudioDataEvent,
} from '@siteed/audio-studio';
import { LegacyEventEmitter } from 'expo-modules-core';
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
import { useSharedValue } from 'react-native-reanimated';

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
  const { currentIndex, setCurrentIndex } = session;

  const [recordingState, setRecordingState] = useState<RecordingState>({ phase: 'idle' });
  const [recorder] = useState(() => createRecordingControls(setRecordingState));
  const transcribing = recordingState.phase === 'submitting';
  const closingRef = useRef(false);
  // Per-chunk visibility override driven by the header reveal/hide button.
  // Cosmetic only; scoring always uses chunk.text. Absence = mode default.
  const [hideModes, setHideModes] = useState<Map<number, HideMode>>(new Map());

  const { startRecording, stopRecording } = useAudioRecorder();
  // Bar levels live in a shared value so the waveform animates on the
  // UI thread without re-rendering this screen (10x/sec while recording)
  const waveformLevels = useSharedValue<number[]>(new Array(WAVEFORM_SAMPLES).fill(0));
  // Meter ballistics state: fast attack, slow release (kills ripple)
  const smoothedLevelRef = useRef(0);

  // Warm the auth session so the first mic press doesn't pay a lazy
  // token refresh serially in front of the Soniox key mint
  useEffect(() => {
    getAuthToken().catch(() => {});
  }, []);

  useEffect(() => () => { void recorder.cancel(); }, [recorder]);

  const handleSubmit = useCallback(async () => {
    if (!recorder.isRecording()) return;
    if (process.env.EXPO_OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    const peekedChunks = session.getPeekedChunks();
    try {
      await recorder.submit((submission) => (
        session.processRecording(submission, peekedChunks.has(submission.index))
      ));
    } catch (error) {
      console.error('Recording submission failed:', error);
      Alert.alert('Error', `Recording failed: ${error}`);
    }
  }, [recorder, session]);

  // The cap submits the latest render's session state, just like the check button.
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  });

  useEffect(() => {
    if (recordingState.phase !== 'recording') return;
    const timer = setTimeout(() => {
      if (!recorder.isRecording()) return;
      showErrorToast('5 minute limit reached — scoring what you recited.');
      void handleSubmitRef.current();
    }, MAX_RECORDING_MS);
    return () => clearTimeout(timer);
  }, [recorder, recordingState]);

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

  // Live feed subscribes to the native stream directly rather than via
  // the hook's onAudioStream: the hook nulls its callback when
  // stopRecording resolves, and the recorder's trailing PCM chunk
  // (emitted inside native stop) can be processed after that resolve —
  // on iOS the resolve is an Immediate-priority task and the chunk is
  // Normal; on Android the chunk hops through the main thread first.
  // This listener outlives the stop, and the session's 50ms flush
  // grace covers that lag.
  useEffect(() => {
    // Same emitter + event the library's own hook listens on (its
    // addAudioEventListener isn't exported from the package root)
    const emitter = new LegacyEventEmitter(AudioStudioModule);
    const subscription = emitter.addListener<{ encoded?: string }>('AudioData', (event) => {
      if (!event.encoded) return;
      recorder.feedAudio(base64ToUint8Array(event.encoded));
    });
    return () => subscription.remove();
  }, [recorder]);

  const handleAudioStream = useCallback(async (event: AudioDataEvent) => {
    if (typeof event.data !== 'string') return;
    const pcm = base64ToUint8Array(event.data);
    if (recorder.isRecording()) {
      const quarter = (pcm.length >> 3) << 1; // even byte boundary
      const bars: number[] = [];
      for (let q = 0; q < 4; q++) {
        const start = q * quarter;
        const end = q === 3 ? pcm.length : (q + 1) * quarter;
        const level = computeBarLevel(pcm, start, end);
        if (level !== null) {
          // Fast attack / slow release: peaks land instantly, but the
          // level decays smoothly instead of flickering bar-to-bar
          const prev = smoothedLevelRef.current;
          const alpha = level > prev ? 0.75 : 0.25;
          const smoothed = prev + alpha * (level - prev);
          smoothedLevelRef.current = smoothed;
          bars.push(smoothed);
        }
      }
      if (bars.length > 0) {
        waveformLevels.value = [...waveformLevels.value.slice(bars.length), ...bars];
      }
    }
  }, [computeBarLevel, recorder, waveformLevels]);

  const handleMicPress = useCallback(async (index: number, isRetry: boolean) => {
    const chunk = session.chunks[index];
    if (!chunk || index !== session.currentIndex || closingRef.current) return;

    try {
      const result = await recorder.start(index, isRetry, {
        async requestPermission() {
          if (process.env.EXPO_OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
          return (await AudioStudioModule.requestPermissionsAsync()).granted;
        },
        openLive: () => startLiveTranscription(chunk.text),
        start() {
          waveformLevels.value = new Array(WAVEFORM_SAMPLES).fill(0);
          smoothedLevelRef.current = 0;
          return startRecording({
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
        },
        stop: stopRecording,
      });
      if (result === 'denied') {
        Alert.alert('Permission required', 'Please allow microphone access to record.');
      }
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  }, [handleAudioStream, recorder, session.chunks, session.currentIndex, startRecording, stopRecording, waveformLevels]);

  const handleCancel = useCallback(() => {
    if (!recorder.canDiscard()) return;
    if (process.env.EXPO_OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    void recorder.cancel();
  }, [recorder]);

  // Reveal/hide button. Easy cycles show → some → all → show (cosmetic).
  // Medium/Hard toggles reveal (show) ↔ original mask; the first reveal
  // taints the chunk (peekChunk) so it scores 0.
  const isEasy = (difficulty ?? 'easy') === 'easy';

  const handleToggleVisibility = useCallback((index: number) => {
    if (recorder.isSubmitting()) return;
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
  }, [isEasy, recorder, session]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const index = viewableItems[0].index;
        if (index !== null && index !== currentIndex) {
          // Cancel any active recording when scrolling away
          void recorder.cancel();
          setCurrentIndex(index);
        }
      }
    },
    [recorder, currentIndex, setCurrentIndex]
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
    const {
      isCompleted, isRetrying, display, originalDisplay, isRetryResult, isPeeked, canContinue, canRetry,
    } = session.getChunkReview(index, recordingState);

    // Completion wins over the chunk's visibility override, except during Retry.
    const hideMode = hideModes.get(index);
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
          {originalDisplay && (() => {
            const badgeScore = originalDisplay.score;
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
              isCompleted || transcribing ? undefined : () => handleToggleVisibility(index)
            }
          />

          {display && (
            <ResultCard
              score={display.score}
              alignment={display.alignment}
              transcription={display.transcription}
              isRetry={isRetryResult}
              isPeeked={isPeeked}
            />
          )}
        </View>

        <View style={styles.controlsContainer}>
          {canContinue && (
            <View style={styles.controlsRow}>
              {canRetry && (
                <Pressable
                  style={[styles.retryButton, { backgroundColor: colors.cardAlt }]}
                  onPress={() => handleMicPress(index, true)}
                  accessibilityLabel="Retry"
                  testID="retry-button"
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
        leftButton={{
          icon: 'xmark',
          label: 'Close',
          onPress: () => {
            if (closingRef.current) return;
            closingRef.current = true;
            void recorder.cancel();
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
        scrollEnabled={recordingState.phase === 'idle' || session.showResults}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      <RecordingBar
        phase={recordingState.phase}
        showMic={currentIndex < session.chunks.length && !session.completedChunks.has(currentIndex)}
        waveformLevels={waveformLevels}
        onStart={() => handleMicPress(currentIndex, false)}
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
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressSegment: {
    flex: 1,
    marginHorizontal: 1,
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
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
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  retryButton: {
    width: 52,
    height: 52,
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
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
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
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
