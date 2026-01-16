import { useEffect, useState, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { subscribeToToast } from '@/lib/toast';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from './icon-symbol';

const TOAST_DURATION = 3000; // Auto-dismiss after 3 seconds
const ANIMATION_DURATION = 250;

export function ErrorToast() {
  const [message, setMessage] = useState<string | null>(null);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  const hideToast = useCallback(() => {
    setMessage(null);
  }, []);

  const animateOut = useCallback(() => {
    translateY.value = withTiming(100, { duration: ANIMATION_DURATION, easing: Easing.in(Easing.cubic) });
    opacity.value = withTiming(0, { duration: ANIMATION_DURATION }, (finished) => {
      if (finished) {
        runOnJS(hideToast)();
      }
    });
  }, [hideToast]);

  // Subscribe to toast messages
  useEffect(() => {
    return subscribeToToast((newMessage) => {
      setMessage(newMessage);
    });
  }, []);

  // Animate in when message appears, auto-dismiss after delay
  useEffect(() => {
    if (message) {
      // Animate in
      translateY.value = withTiming(0, { duration: ANIMATION_DURATION, easing: Easing.out(Easing.cubic) });
      opacity.value = withTiming(1, { duration: ANIMATION_DURATION });

      // Auto-dismiss
      const timeout = setTimeout(() => {
        animateOut();
      }, TOAST_DURATION);

      return () => clearTimeout(timeout);
    }
  }, [message, animateOut]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!message) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        animatedStyle,
        { bottom: insets.bottom + 16 },
      ]}
    >
      <Pressable
        onPress={animateOut}
        style={[styles.toast, { backgroundColor: colors.error }]}
      >
        <IconSymbol name="exclamationmark.circle.fill" size={20} color={colors.white} />
        <Text style={[styles.message, { color: colors.white }]}>{message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  message: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
});
