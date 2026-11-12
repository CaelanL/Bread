import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StyleSheet, Text, View } from 'react-native';

const MAX_DOTS = 5;

/** One member's initial in a circle, as the strip and Who's where show them. */
export function InitialDot({ name }: { name: string }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={[styles.dot, { backgroundColor: colors.primaryLight, borderColor: colors.card }]}>
      <Text style={[styles.initial, { color: colors.text }]}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

/** Overlapping initials, five at most, then "+N" for the rest of `count`. */
export function MemberDots({ names, count = names.length }: { names: string[]; count?: number }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const shown = names.slice(0, MAX_DOTS);
  const extra = count - shown.length;
  return (
    <View style={styles.row} accessibilityLabel={`${count} member${count === 1 ? '' : 's'}`}>
      {shown.map((name, index) => (
        <View key={`${name}-${index}`} style={styles.overlap}><InitialDot name={name} /></View>
      ))}
      {extra > 0 && (
        <View style={[styles.dot, styles.overlap, { backgroundColor: colors.cardAlt, borderColor: colors.card }]}>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlap: { marginLeft: -6 },
  initial: { fontSize: 12, fontWeight: '600' },
});
