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
  isResultsPage,
} from '@/lib/study-chunks';
import { Audio } from 'expo-av';
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
  const [waveformTrigger, setWaveformTrigger] = useState(0);
  const [exitingChunks, setExitingChunks] = useState<Set<number>>(new Set());

  const recordingRef = useRef<Audio.Recording | null>(null);
  const meteringRef = useRef<NodeJS.Timeout | null>(null);
  const waveformDataRef = useRef<number[]>([]);

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
      if (meteringRef.current) {
        clearInterval(meteringRef.current);
        meteringRef.current = null;
      }
    };
  }, []);

  const stopMetering = useCallback(() => {
    if (meteringRef.current) {
      clearInterval(meteringRef.current);
      meteringRef.current = null;
    }
    waveformDataRef.current = [];
  }, []);

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

  const handleMicPress = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Please allow microphone access to record.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;

      // Show recording bar
      recordingTabY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });

      // Start metering
      waveformDataRef.current = [];
      setWaveformTrigger(0);
      meteringRef.current = setInterval(async () => {
        if (recordingRef.current) {
          const status = await recordingRef.current.getStatusAsync();
          if (status.isRecording && typeof status.metering === 'number') {
            const minDb = -26;
            const maxDb = -6;
            const normalized = Math.max(0, Math.min(1, (status.metering - minDb) / (maxDb - minDb)));

            waveformDataRef.current.push(normalized);
            if (waveformDataRef.current.length > WAVEFORM_SAMPLES) {
              waveformDataRef.current = waveformDataRef.current.slice(-WAVEFORM_SAMPLES);
            }
            setWaveformTrigger((t) => t + 1);
          }
        }
      }, 50);

      setRecordingState('recording');
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  }, []);

  const handleCancel = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    stopMetering();
    hideRecordingBar();

    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        recordingRef.current = null;
      }
    } catch (error) {
      console.error('Failed to cancel recording:', error);
    }

    setRecordingState('idle');
  }, [stopMetering, hideRecordingBar]);

  const handleSubmit = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stopMetering();

    if (!recordingRef.current) {
      setRecordingState('idle');
      return;
    }

    try {
      setTranscribing(true);

      // Get duration before stopping
      const status = await recordingRef.current.getStatusAsync();
      const durationMs = status.durationMillis ?? 0;

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        throw new Error('No recording URI');
      }

      setRecordingState('idle');

      // Process recording through session hook (with duration in ms)
      await session.processRecording(uri, durationMs);

      // Hide bar after processing
      hideRecordingBar(() => setTranscribing(false));
    } catch (error) {
      console.error('Recording submission failed:', error);
      hideRecordingBar(() => setTranscribing(false));
      Alert.alert('Error', `Recording failed: ${error}`);
      setRecordingState('idle');
    }
  }, [stopMetering, hideRecordingBar, session]);

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

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0) {
        const index = viewableItems[0].index;
        if (index !== null && index !== session.currentIndex) {
          // Cancel any active recording when scrolling away
          if (recordingRef.current) {
            recordingRef.current.stopAndUnloadAsync().catch(() => {});
            recordingRef.current = null;
            setRecordingState('idle');
          }
          session.setCurrentIndex(index);
        }
      }
    },
    [session.currentIndex, session.setCurrentIndex]
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
          {/* Score badge on top of verse card when completed */}
          {isCompleted && result && (
            <View style={[styles.scoreBadgeRow]}>
              <View style={[styles.scoreBadgeInline, {
                backgroundColor: `${getScoreColor(result.score)}20`,
              }]}>
                <Text style={[styles.scoreBadgeInlineText, {
                  color: getScoreColor(result.score),
                }]}>
                  Score: {result.score}%
                </Text>
              </View>
            </View>
          )}

          <VerseCard chunk={item} difficulty={difficulty ?? 'easy'} verseLabel={verseLabel} revealed={isCompleted && !isRetrying} />

          {/* Show original result or retry result */}
          {showResult && result && !retryResult && (
            <ResultCard
              score={result.score}
              alignment={result.alignment}
              transcription={result.transcription}
              exiting={isExiting}
              onExitComplete={() => handleExitComplete(index)}
            />
          )}
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

          {/* Next + Retry buttons */}
          {recordingState === 'idle' &&
            !transcribing &&
            isCompleted &&
            !isRetrying &&
            !isExiting &&
            session.currentIndex === index && (
              <View style={styles.controlsRow}>
                <Pressable
                  style={[styles.retryButton, { backgroundColor: colors.cardAlt }]}
                  onPress={() => handleRetry(index)}
                >
                  <IconSymbol name="arrow.counterclockwise" size={22} color={colors.text} />
                </Pressable>
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
        waveformDataRef={waveformDataRef}
        waveformTrigger={waveformTrigger}
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
