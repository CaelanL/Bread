import React from 'react';
import { View, StyleSheet } from 'react-native';

const WAVEFORM_SAMPLES = 80;

interface WaveformProps {
  dataRef: React.MutableRefObject<number[]>;
  trigger: number;
}

/**
 * Audio waveform visualization component.
 * Renders bars based on audio level data from the dataRef.
 * Only re-renders when trigger changes (memoized).
 */
export const Waveform = React.memo(function Waveform({ dataRef, trigger }: WaveformProps) {
  const baseHeight = 2;
  const maxHeight = 28;

  return (
    <View style={styles.container}>
      {dataRef.current.map((level, i) => {
        const curved = Math.pow(level, 0.6);
        const height = baseHeight + (maxHeight - baseHeight) * curved;
        return (
          <View
            key={i}
            style={[styles.bar, { height }]}
          />
        );
      })}
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
    gap: 1.5,
    height: 32,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  bar: {
    width: 2,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 1,
    minHeight: 3,
  },
});
