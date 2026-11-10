import { useEffect } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RecordingState } from '@/lib/transcription/recording-controls';
import { Waveform } from './Waveform';

export const RECORDING_BAR_HEIGHT = 72;
const SIZE = RECORDING_BAR_HEIGHT;
const INSET = 20;
const EASING = Easing.bezier(...Motion.easing);

interface RecordingBarProps {
  phase: RecordingState['phase'];
  showMic: boolean;
  waveformLevels: SharedValue<number[]>;
  onStart: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RecordingBar({
  phase, showMic, waveformLevels, onStart, onCancel, onSubmit,
}: RecordingBarProps) {
  const { width } = useWindowDimensions();
  const colors = Colors[useColorScheme() ?? 'light'];
  const reducedMotion = useReducedMotion();
  const expanded = phase === 'starting' || phase === 'recording' || phase === 'submitting';
  const canStart = showMic && phase === 'idle';
  const canDiscard = phase === 'starting' || phase === 'recording';
  const travel = Math.max(0, width - 2 * INSET - SIZE) / 2;
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: expanded ? Motion.expandMs : Motion.exitMs,
      easing: EASING,
      reduceMotion: ReduceMotion.Never,
    });
  }, [expanded, progress]);

  useEffect(() => {
    if (phase === 'recording' && process.env.EXPO_OS === 'ios') {
      AccessibilityInfo.announceForAccessibility('Listening');
    }
  }, [phase]);

  // Only the flat center stretches. The fixed action targets stay clear of a second mic tap.
  const left = useAnimatedStyle(() => ({
    transform: [{ translateX: -travel * progress.value }],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [{ translateX: travel * progress.value }],
  }));
  const center = useAnimatedStyle(() => ({
    transform: [{ scaleX: (2 * travel / SIZE) * progress.value }],
  }));
  const visibility = useAnimatedStyle(() => ({ opacity: showMic ? 1 : progress.value }));
  const activeFade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const micFade = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const actionFade = useAnimatedStyle(() => ({
    opacity: reducedMotion ? progress.value : interpolate(progress.value, [0.75, 1], [0, 1], 'clamp'),
  }));
  const waveformStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: reducedMotion ? 1 : progress.value }],
  }));

  const fill = { backgroundColor: colors.primary };
  const ink = { color: colors.onPrimary };
  const status = phase === 'starting' ? 'Starting…'
    : phase === 'recording' ? 'Listening'
    : 'Analyzing…';

  return (
    <Animated.View pointerEvents="box-none" style={[styles.bar, visibility]}>
      {reducedMotion ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[styles.round, styles.centeredShape, fill]} />
          <Animated.View style={[StyleSheet.absoluteFill, styles.pill, fill, activeFade]} />
        </View>
      ) : (
        <Animated.View pointerEvents="none" style={[styles.square, fill, center]} />
      )}
      {!reducedMotion && (
        <>
          <Animated.View pointerEvents="none" style={[styles.round, fill, left]} />
          <Animated.View pointerEvents="none" style={[styles.round, fill, right]} />
        </>
      )}
      {canDiscard && (
        <Animated.View pointerEvents="box-none" style={[styles.actions, actionFade]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard recording"
            testID="discard-recording"
            onPress={onCancel}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <IconSymbol name="xmark" size={21} color={colors.onPrimary} />
          </Pressable>
          {phase === 'recording' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Submit recording"
              testID="submit-recording"
              onPress={onSubmit}
              style={({ pressed }) => [
                styles.action, { backgroundColor: colors.onPrimaryTint }, pressed && styles.pressed,
              ]}
            >
              <IconSymbol name="checkmark" size={23} color={colors.onPrimary} />
            </Pressable>
          )}
        </Animated.View>
      )}

      {expanded && (
        <Animated.View pointerEvents="none" style={[styles.status, activeFade]}>
          <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.label, ink]}>
            {status}
          </Text>
          {phase === 'recording' ? (
            <Animated.View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.signal, waveformStyle]}
            >
              <Waveform levels={waveformLevels} color={colors.onPrimary} />
            </Animated.View>
          ) : (
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.signal, styles.dots]}
            >
              {[0, 1, 2].map((dot) => (
                <View key={dot} style={[styles.dot, { backgroundColor: colors.onPrimary }]} />
              ))}
            </View>
          )}
        </Animated.View>
      )}

      {showMic && (
        <Animated.View
          pointerEvents={canStart ? 'auto' : 'none'}
          accessibilityElementsHidden={!canStart}
          importantForAccessibility={canStart ? 'auto' : 'no-hide-descendants'}
          style={[styles.round, micFade]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start recording"
            testID="mic-button"
            onPress={onStart}
            disabled={!canStart}
            style={({ pressed }) => [styles.mic, pressed && styles.pressed]}
          >
            <IconSymbol name="mic.fill" size={32} color={colors.onPrimary} />
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 56,
    left: INSET,
    right: INSET,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  square: { position: 'absolute', width: SIZE, height: SIZE },
  round: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centeredShape: { alignSelf: 'center' },
  pill: { borderRadius: Radius.full },
  mic: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  action: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.68 },
  status: {
    position: 'absolute',
    left: 64,
    right: 64,
    alignItems: 'center',
    gap: 3,
  },
  label: { fontSize: 13, fontWeight: '600' },
  signal: { width: '100%', height: 22 },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { width: 4, height: 4, borderRadius: Radius.full },
});
