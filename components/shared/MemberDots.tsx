import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StyleSheet, Text, View } from 'react-native';

const MAX_DOTS = 5;

/**
 * One member's initial in a circle: 24 in the strip and grid, `large` 32 in member rows. Yours is
 * the only solid one. `ring` adds an edge in the surface colour that separates overlapping circles.
 */
export function InitialDot({ name, you = false, large = false, ring }: {
  name: string;
  you?: boolean;
  large?: boolean;
  /** The surface colour behind overlapping circles, drawn as their edge. */
  ring?: string;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const fill = you ? colors.primary : colors.primaryLight;
  // A ringed dot sits over its neighbour: the surface colour under the translucent fill keeps it opaque.
  return (
    <View style={[large ? styles.large : styles.dot, ring ? [styles.ring, { borderColor: ring, backgroundColor: ring }] : { backgroundColor: fill }]}>
      {ring && <View style={[StyleSheet.absoluteFill, styles.inner, { backgroundColor: fill }]} />}
      <Text style={[large ? styles.largeInitial : styles.initial, { color: you ? colors.white : colors.text }]}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

/** Overlapping initials, five at most, then "+N" for the rest of `count`, edged in `surface` (the card by default). */
export function MemberDots({ members, count = members.length, surface }: {
  members: { name: string; you?: boolean }[];
  count?: number;
  surface?: string;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const ring = surface ?? colors.card;
  const shown = members.slice(0, MAX_DOTS);
  const extra = count - shown.length;
  return (
    <View style={styles.row} accessibilityLabel={`${count} member${count === 1 ? '' : 's'}`}>
      {shown.map((member, index) => (
        <View key={`${member.name}-${index}`} style={styles.overlap}><InitialDot name={member.name} you={member.you} ring={ring} /></View>
      ))}
      {extra > 0 && (
        <View style={[styles.dot, styles.ring, styles.overlap, { backgroundColor: colors.cardAlt, borderColor: ring }]}>
          <Text style={[styles.initial, { color: colors.icon }]}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingLeft: 6 },
  dot: { width: 24, height: 24, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  large: { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2 },
  inner: { borderRadius: Radius.full },
  overlap: { marginLeft: -6 },
  initial: { fontSize: 11, fontWeight: '600' },
  largeInitial: { fontSize: 13, fontWeight: '600' },
});
