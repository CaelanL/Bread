import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import Animated, { SharedValue } from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Waveform } from './Waveform';

const RECORDING_BAR_HEIGHT = 56;

interface RecordingBarProps {
  isProcessing: boolean;
  waveformLevels: SharedValue<number[]>;
  animatedStyle: ViewStyle;
  spinnerStyle: ViewStyle;
  onCancel: () => void;
  onSubmit: () => void;
}

export function RecordingBar({
  isProcessing,
  waveformLevels,
  animatedStyle,
  spinnerStyle,
  onCancel,
  onSubmit,
}: RecordingBarProps) {
  return (
    <Animated.View
      style={[
        styles.recordingBar,
        isProcessing ? styles.recordingBarProcessing : styles.recordingBarActive,
        animatedStyle,
      ]}
    >
      {isProcessing ? (
        <View style={styles.processingBarContent}>
          <Animated.View style={[styles.spinner, spinnerStyle]}>
            <View style={styles.spinnerArc} />
          </Animated.View>
          <Text style={styles.processingText}>Analyzing your recitation...</Text>
        </View>
      ) : (
        <View style={styles.recordingBarContent}>
          {/* Cancel button */}
          <Pressable onPress={onCancel} style={styles.barCancelButton}>
            <IconSymbol name="xmark" size={22} color="rgba(255,255,255,0.8)" />
          </Pressable>

          {/* Scrolling audio waveform */}
          <Waveform levels={waveformLevels} />

          {/* Submit button */}
          <Pressable onPress={onSubmit} style={styles.barSubmitButton}>
            <IconSymbol name="checkmark" size={24} color="#fff" />
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

export { RECORDING_BAR_HEIGHT };

const styles = StyleSheet.create({
  recordingBar: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    height: RECORDING_BAR_HEIGHT,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  recordingBarActive: {
    backgroundColor: '#ef4444',
  },
  recordingBarProcessing: {
    backgroundColor: '#374151',
  },
  recordingBarContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  barCancelButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  barSubmitButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingBarContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  spinner: {
    width: 20,
    height: 20,
  },
  spinnerArc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: '#9ca3af',
    borderTopColor: 'transparent',
  },
  processingText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '500',
  },
});
