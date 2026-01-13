import { useRef, useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import { WAVEFORM_SAMPLES } from '@/components/study/Waveform';
import { RECORDING_BAR_HEIGHT } from '@/components/study/RecordingBar';

type RecordingState = 'idle' | 'recording';

interface UseRecordingOptions {
  onRecordingComplete: (uri: string) => Promise<void>;
}

interface UseRecordingReturn {
  // State
  recordingState: RecordingState;
  transcribing: boolean;
  waveformDataRef: React.MutableRefObject<number[]>;
  waveformTrigger: number;

  // Animated styles
  recordingTabStyle: { transform: { translateY: number }[] };
  spinnerStyle: { transform: { rotate: string }[] };

  // Actions
  startRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  submitRecording: () => Promise<void>;

  // For manual transcribing control (called by parent after processing)
  setTranscribing: (value: boolean) => void;
  hideRecordingBar: (onComplete?: () => void) => void;
}

export function useRecording({ onRecordingComplete }: UseRecordingOptions): UseRecordingReturn {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [transcribing, setTranscribing] = useState(false);
  const [waveformTrigger, setWaveformTrigger] = useState(0);

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

  const startRecording = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Clean up any existing recording first
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }

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
            setWaveformTrigger(t => t + 1);
          }
        }
      }, 50);

      setRecordingState('recording');
    } catch (error) {
      console.error('Failed to start recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  }, []);

  const cancelRecording = useCallback(async () => {
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

  const submitRecording = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    stopMetering();

    if (!recordingRef.current) {
      setRecordingState('idle');
      return;
    }

    try {
      setTranscribing(true);

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        throw new Error('No recording URI');
      }

      setRecordingState('idle');

      // Call the completion handler - parent will handle hiding bar
      await onRecordingComplete(uri);
    } catch (error) {
      console.error('Recording submission failed:', error);
      hideRecordingBar(() => setTranscribing(false));
      Alert.alert('Error', 'Recording failed');
      setRecordingState('idle');
    }
  }, [stopMetering, hideRecordingBar, onRecordingComplete]);

  return {
    recordingState,
    transcribing,
    waveformDataRef,
    waveformTrigger,
    recordingTabStyle,
    spinnerStyle,
    startRecording,
    cancelRecording,
    submitRecording,
    setTranscribing,
    hideRecordingBar,
  };
}
