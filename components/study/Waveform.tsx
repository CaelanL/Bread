import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Motion, Radius } from '@/constants/theme';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

const WAVEFORM_SAMPLES = 80;

const BASE_HEIGHT = 3;
const MAX_HEIGHT = 22;

interface WaveformProps {
  levels: SharedValue<number[]>;
  color: string;
}

/**
 * One bar. Height animates on the UI thread toward the bar's slot in
 * the shared levels array — the tween (slightly longer than the 100ms
 * audio-chunk cadence) is what makes the wave flow instead of snap.
 */
function Bar({ levels, color, index }: WaveformProps & { index: number }) {
  const animatedStyle = useAnimatedStyle(() => {
    const curved = Math.pow(levels.value[index] ?? 0, 0.6);
    return {
      height: withTiming(BASE_HEIGHT + (MAX_HEIGHT - BASE_HEIGHT) * curved, {
        duration: Motion.pressMs,
        easing: Easing.linear,
      }),
    };
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        // Older bars (left) fade out toward the tail
        { backgroundColor: color, opacity: 0.35 + 0.65 * (index / (WAVEFORM_SAMPLES - 1)) },
        animatedStyle,
      ]}
    />
  );
}

/**
 * Audio waveform visualization. Levels live in a Reanimated shared
 * value written straight from the PCM stream, so the waveform never
 * causes a React re-render while recording.
 */
export const Waveform = React.memo(function Waveform({ levels, color }: WaveformProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: WAVEFORM_SAMPLES }, (_, i) => (
        <Bar key={i} levels={levels} color={color} index={i} />
      ))}
    </View>
  );
});

export { WAVEFORM_SAMPLES };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    overflow: 'hidden',
  },
  bar: {
    // Bars split the available width evenly, so the waveform always
    // spans the full gap between the cancel and submit buttons
    // regardless of screen width.
    flex: 1,
    borderRadius: Radius.full,
  },
});
