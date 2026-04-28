/**
 * Compact "N due" pill rendered on the Mastered collection row when one
 * or more verses are due for review. Hidden when count is zero.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  count: number;
}

export function DueCountPill({ count }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  if (count <= 0) return null;

  return (
    <View style={[styles.pill, { backgroundColor: colors.tint }]}>
      <Text style={styles.label}>{count} due</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  label: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
});
