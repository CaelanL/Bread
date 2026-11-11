import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { type SharedValue, useAnimatedReaction, useAnimatedStyle } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export const SWIPE_DELETE_DISTANCE = 72;

export function SwipeDeleteAction({
  offset,
  onPress,
}: {
  offset: SharedValue<number>;
  onPress: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [revealed, setRevealed] = useState(false);
  useAnimatedReaction(
    () => offset.value <= -SWIPE_DELETE_DISTANCE / 2,
    (open, previous) => {
      if (open !== previous) scheduleOnRN(setRevealed, open);
    },
  );
  const reveal = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(offset.value) / (SWIPE_DELETE_DISTANCE / 2)),
  }));

  return (
    <Animated.View
      style={[styles.reveal, reveal, { backgroundColor: colors.destructiveAction }]}
      accessibilityElementsHidden={!revealed}
      importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
      pointerEvents={revealed ? 'auto' : 'none'}
    >
      <Pressable
        style={styles.action}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Delete"
        testID="swipe-delete"
      >
        <IconSymbol name="trash" size={16} color={colors.white} />
        <Text style={[styles.label, { color: colors.white }]}>Delete</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  reveal: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    right: 0,
    width: 64,
    borderRadius: Radius.lg,
  },
  action: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
  },
});
