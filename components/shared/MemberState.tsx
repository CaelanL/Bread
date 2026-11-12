import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isMasteredState, type MemberState } from '@/lib/shared/progress';
import { StyleSheet, Text, View } from 'react-native';

type Palette = (typeof Colors)['light'];

export const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  open: 'Open',
  learning: 'Learning',
  mastered: 'Mastered',
  engraved: 'Engraved',
};

/** One colour per state, for dots, bars and (slice 4) grid squares. Open is a border only. */
export function memberStateFill(state: MemberState, colors: Palette): string {
  if (state === 'engraved') return colors.tint;
  if (state === 'mastered') return colors.success;
  if (state === 'learning') return `${colors.warning}4D`;
  return 'transparent';
}

const DOT_BORDER: Record<MemberState, (colors: Palette) => string> = {
  open: (colors) => colors.border,
  learning: (colors) => colors.warning,
  mastered: () => 'transparent',
  engraved: () => 'transparent',
};

/** Your state on a verse, as a dot. */
export function MemberStateDot({ state }: { state: MemberState }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View
      accessibilityLabel={`You: ${MEMBER_STATE_LABEL[state]}`}
      style={[styles.dot, { backgroundColor: memberStateFill(state, colors), borderColor: DOT_BORDER[state](colors) }]}
    />
  );
}

/** The group's count on a verse: "1/2" over a bar of every member's state, or "All" when everyone mastered it. */
export function GroupCount({ states }: { states: MemberState[] | null }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  if (!states || states.length === 0) {
    return (
      <View style={styles.group} accessibilityLabel="Group: loading">
        <Text style={[styles.count, { color: colors.icon }]}>–</Text>
      </View>
    );
  }
  const mastered = states.filter(isMasteredState).length;
  const all = mastered === states.length;
  const allEngraved = states.every((s) => s === 'engraved');
  const order: MemberState[] = ['engraved', 'mastered', 'learning', 'open'];
  const sorted = [...states].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return (
    <View
      style={styles.group}
      accessibilityLabel={all ? `Group: everyone ${allEngraved ? 'engraved' : 'mastered'}` : `Group: ${mastered} of ${states.length} mastered`}
    >
      <Text style={[styles.count, { color: all ? (allEngraved ? colors.tint : colors.success) : colors.text }]}>
        {all ? '✓ All' : `${mastered}/${states.length}`}
      </Text>
      <View style={[styles.bar, { backgroundColor: colors.borderLight }]}>
        {sorted.map((state, index) => (
          <View key={index} style={[styles.segment, { backgroundColor: memberStateFill(state, colors) }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: Radius.full, borderWidth: 1.5 },
  group: { width: 44, alignItems: 'flex-end', gap: 5 },
  count: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', width: 36, height: 4, borderRadius: Radius.xs, overflow: 'hidden' },
  segment: { flex: 1 },
});
