import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

const WAVEFORM_SAMPLES = 80;

const BASE_HEIGHT = 3;
const MAX_HEIGHT = 28;

interface WaveformProps {
  levels: SharedValue<number[]>;
}

/**
 * One bar. Height animates on the UI thread toward the bar's slot in
 * the shared levels array — the tween (slightly longer than the 100ms
 * audio-chunk cadence) is what makes the wave flow instead of snap.
 */
function Bar({ levels, index }: WaveformProps & { index: number }) {
  const animatedStyle = useAnimatedStyle(() => {
    const curved = Math.pow(levels.value[index] ?? 0, 0.6);
    return {
      height: withTiming(BASE_HEIGHT + (MAX_HEIGHT - BASE_HEIGHT) * curved, {
        duration: 130,
        easing: Easing.linear,
      }),
    };
  });

  return (
    <Animated.View
      style={[
        styles.bar,
        // Older bars (left) fade out toward the tail
        { opacity: 0.35 + 0.65 * (index / (WAVEFORM_SAMPLES - 1)) },
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
export const Waveform = React.memo(function Waveform({ levels }: WaveformProps) {
  return (
    <View style={styles.container}>
      {Array.from({ length: WAVEFORM_SAMPLES }, (_, i) => (
        <Bar key={i} levels={levels} index={i} />
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
    justifyContent: 'flex-end',
    gap: 1,
    height: 32,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  bar: {
    width: 1.5,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 1,
  },
});
