import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Pressable, StyleSheet, Text } from 'react-native';

/** The full-width bronze "Start session" capsule docked at the bottom of study setup. */
export function StartButton({ onPress }: { onPress: () => void }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.actionFill }, pressed && styles.pressed]}
    >
      <Text style={[styles.text, { color: colors.white }]}>Start session</Text>
      <IconSymbol name="arrow.right" size={18} color={colors.white} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: Shadows.action,
  },
  pressed: { opacity: 0.85 },
  text: { fontSize: 17, fontWeight: '600' },
});
