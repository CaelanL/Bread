import { useEffect } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Motion, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RecordingState } from '@/lib/transcription/recording-controls';
import { Waveform } from './Waveform';

export const RECORDING_BAR_HEIGHT = 72;
const SIZE = RECORDING_BAR_HEIGHT;
const PILL_HEIGHT = 48;
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
  const starting = phase === 'starting';
  const recording = phase === 'recording';
  const submitting = phase === 'submitting';
  const expanded = recording || submitting;
  const canStart = showMic && phase === 'idle';
  const barWidth = Math.min(width - 40, 304);
  const travel = Math.max(0, barWidth - PILL_HEIGHT) / 2;
  const progress = useSharedValue(expanded ? 1 : 0);
  const spin = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: expanded ? Motion.expandMs : Motion.exitMs,
      easing: EASING,
      reduceMotion: ReduceMotion.Never,
    });
  }, [expanded, progress]);

  useEffect(() => {
    if (!starting || reducedMotion) return;
    spin.value = 0;
    spin.value = withRepeat(withTiming(360, {
      duration: Motion.spinnerMs,
      easing: Easing.linear,
    }), -1);
    return () => cancelAnimation(spin);
  }, [starting, reducedMotion, spin]);

  useEffect(() => {
    if (recording && process.env.EXPO_OS === 'ios') {
      AccessibilityInfo.announceForAccessibility('Listening');
    }
  }, [recording]);

  // Uniformly shrink the round ends while widening the flat center. Glyphs keep their size.
  const left = useAnimatedStyle(() => ({
    transform: [
      { translateX: -travel * progress.value },
      { scale: interpolate(progress.value, [0, 1], [1, PILL_HEIGHT / SIZE]) },
    ],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [
      { translateX: travel * progress.value },
      { scale: interpolate(progress.value, [0, 1], [1, PILL_HEIGHT / SIZE]) },
    ],
  }));
  const center = useAnimatedStyle(() => ({
    transform: [
      { scaleX: (2 * travel / SIZE) * progress.value },
      { scaleY: interpolate(progress.value, [0, 1], [1, PILL_HEIGHT / SIZE]) },
    ],
  }));
  const visibility = useAnimatedStyle(() => ({
    opacity: showMic || starting ? 1 : progress.value,
  }));
  const activeFade = useAnimatedStyle(() => ({ opacity: progress.value }));
  const micFade = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const shadowFade = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{
      scaleY: reducedMotion ? 1 : interpolate(progress.value, [0, 1], [1, PILL_HEIGHT / SIZE]),
    }],
  }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const actionFade = useAnimatedStyle(() => ({
    opacity: reducedMotion ? progress.value : interpolate(progress.value, [0.75, 1], [0, 1], 'clamp'),
  }));

  const fill = { backgroundColor: colors.recordingControl };

  return (
    <Animated.View pointerEvents="box-none" style={[styles.bar, { width: barWidth }, visibility]}>
      <Animated.View pointerEvents="none" style={[styles.round, styles.micSurface, fill, shadowFade]} />
      {reducedMotion ? (
        <Animated.View pointerEvents="none" style={[styles.pill, fill, activeFade]} />
      ) : (
        <>
          <Animated.View pointerEvents="none" style={[styles.square, fill, center]} />
          <Animated.View pointerEvents="none" style={[styles.round, fill, left]} />
          <Animated.View pointerEvents="none" style={[styles.round, fill, right]} />
        </>
      )}

      {(starting || recording) && (
        <Animated.View pointerEvents="box-none" style={[styles.actions, recording && actionFade]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard recording"
            testID="discard-recording"
            onPress={onCancel}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <IconSymbol name="xmark" size={17} color={starting ? colors.icon : colors.white} />
          </Pressable>
          {recording && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Submit recording"
              testID="submit-recording"
              onPress={onSubmit}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <View style={[styles.confirm, { backgroundColor: colors.recordingAction }]}>
                <IconSymbol name="checkmark" size={18} color={colors.white} />
              </View>
            </Pressable>
          )}
        </Animated.View>
      )}

      {expanded && (
        <Animated.View pointerEvents="none" style={[styles.signal, activeFade]}>
          {recording ? (
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveform}>
              <Waveform levels={waveformLevels} color={colors.white} />
            </View>
          ) : (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Analyzing recording"
              accessibilityState={{ busy: true }}
              testID="analyzing-recording"
              style={styles.analysis}
            >
              {reducedMotion ? (
                [0, 1, 2].map((dot) => (
                  <View key={dot} style={[styles.dot, { backgroundColor: colors.white }]} />
                ))
              ) : (
                <ActivityIndicator size="small" color={colors.white} />
              )}
            </View>
          )}
        </Animated.View>
      )}

      {(showMic || starting || expanded) && (
        <Animated.View
          pointerEvents={canStart ? 'auto' : 'none'}
          accessibilityElementsHidden={!canStart && !starting}
          importantForAccessibility={canStart || starting ? 'auto' : 'no-hide-descendants'}
          style={[styles.round, micFade]}
        >
          {starting ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Starting recording"
              accessibilityState={{ busy: true }}
              testID="starting-recording"
              style={styles.round}
            >
              <Animated.View
                style={[
                  styles.ring,
                  {
                    borderColor: reducedMotion ? colors.primary : colors.primaryLight,
                    borderTopColor: colors.primary,
                    borderRightColor: colors.primary,
                  },
                  ringStyle,
                ]}
              />
              <IconSymbol name="mic.fill" size={28} color={colors.white} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start recording"
              testID="mic-button"
              onPress={onStart}
              disabled={!canStart}
              style={({ pressed }) => [styles.mic, pressed && styles.pressed]}
            >
              <IconSymbol name="mic.fill" size={28} color={colors.white} />
            </Pressable>
          )}
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    bottom: 56,
    alignSelf: 'center',
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
  micSurface: { boxShadow: Shadows.floating },
  pill: { position: 'absolute', width: '100%', height: PILL_HEIGHT, borderRadius: Radius.full },
  mic: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: SIZE + 8,
    height: SIZE + 8,
    borderWidth: 2,
    borderRadius: Radius.full,
  },
  actions: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  action: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirm: {
    width: 34,
    height: 34,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.68 },
  signal: {
    position: 'absolute',
    left: 58,
    right: 58,
    height: 22,
  },
  waveform: { flex: 1 },
  analysis: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  dot: { width: 4, height: 4, borderRadius: Radius.full },
});
