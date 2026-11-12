import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StyleSheet, Text, View } from 'react-native';

const MAX_DOTS = 5;

/** Overlapping initials, five at most, then "+N" for the rest of `count`. */
export function MemberDots({ names, count = names.length }: { names: string[]; count?: number }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const shown = names.slice(0, MAX_DOTS);
  const extra = count - shown.length;
  const dot = { backgroundColor: colors.primaryLight, borderColor: colors.card };
  return (
    <View style={styles.row} accessibilityLabel={`${count} member${count === 1 ? '' : 's'}`}>
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={[styles.dot, dot]}>
          <Text style={[styles.initial, { color: colors.text }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
        </View>
      ))}
      {extra > 0 && (
        <View style={[styles.dot, { backgroundColor: colors.cardAlt, borderColor: colors.card }]}>
          <Text style={[styles.initial, { color: colors.icon }]}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingLeft: 6 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    borderWidth: 2,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontSize: 12, fontWeight: '600' },
});
