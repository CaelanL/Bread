/**
 * Minimal horizontal slider for picking an integer day count. Used by the
 * Review System settings section to set the user's max review interval.
 *
 * Built on react-native-gesture-handler (already in the project) so we
 * don't pull in @react-native-community/slider just for one screen.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

interface Props {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Width of the thumb element. */
  thumbSize?: number;
}

export function IntervalSlider({ value, min, max, onChange, thumbSize = 22 }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthSv = useSharedValue(0);
  const dragX = useSharedValue<number | null>(null);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackWidth(w);
    trackWidthSv.value = w;
  };

  const setFromPosition = (xPx: number) => {
    if (trackWidth <= 0) return;
    const clampedX = Math.max(0, Math.min(trackWidth, xPx));
    const f = clampedX / trackWidth;
    const next = Math.round(min + f * (max - min));
    if (next !== value) onChange(next);
  };

  const tap = Gesture.Tap()
    .onEnd((e) => {
      runOnJS(setFromPosition)(e.x);
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      dragX.value = e.x;
      runOnJS(setFromPosition)(e.x);
    })
    .onEnd(() => {
      dragX.value = null;
    });

  const composed = Gesture.Simultaneous(tap, pan);

  const thumbStyle = useAnimatedStyle(() => {
    const w = trackWidthSv.value;
    if (w <= 0) return { transform: [{ translateX: 0 }] };
    const drag = dragX.value;
    const baseFrac = max > min ? (value - min) / (max - min) : 0;
    const x = drag !== null
      ? Math.max(0, Math.min(w, drag))
      : baseFrac * w;
    return { transform: [{ translateX: x - thumbSize / 2 }] };
  });

  const fillStyle = useAnimatedStyle(() => {
    const w = trackWidthSv.value;
    if (w <= 0) return { width: 0 };
    const drag = dragX.value;
    const baseFrac = max > min ? (value - min) / (max - min) : 0;
    const x = drag !== null
      ? Math.max(0, Math.min(w, drag))
      : baseFrac * w;
    return { width: x };
  });

  const trackBg = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.container}>
        <View
          onLayout={onTrackLayout}
          style={[styles.track, { backgroundColor: trackBg }]}
        >
          <Animated.View style={[styles.fill, { backgroundColor: colors.tint }, fillStyle]} />
          <Animated.View
            style={[
              styles.thumb,
              {
                backgroundColor: colors.tint,
                width: thumbSize,
                height: thumbSize,
                borderRadius: thumbSize / 2,
                top: -((thumbSize - 4) / 2),
              },
              thumbStyle,
            ]}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: 2,
    width: '100%',
    position: 'relative',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});
