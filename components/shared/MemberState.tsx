import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { barSegments, isMasteredState, type MemberState } from '@/lib/shared/progress';
import { StyleSheet, Text, View } from 'react-native';

type Palette = (typeof Colors)['light'];

export const MEMBER_STATE_LABEL: Record<MemberState, string> = {
  open: 'Open',
  learning: 'Learning',
  mastered: 'Mastered',
  engraved: 'Engraved',
};

/** One solid fill per state, for dots, bars, tiles and the legend. Open is the surface one step up. */
export function memberStateFill(state: MemberState, colors: Palette): string {
  if (state === 'engraved') return colors.tint;
  if (state === 'mastered') return colors.success;
  if (state === 'learning') return colors.warning;
  return colors.cardAlt;
}

// Open also gets a hairline so the empty fill still shows on the card.
function stateStyle(state: MemberState, colors: Palette) {
  return state === 'open'
    ? { backgroundColor: colors.cardAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight }
    : { backgroundColor: memberStateFill(state, colors) };
}

/** Your state on a verse, as a dot. */
export function MemberStateDot({ state }: { state: MemberState }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return <View accessibilityLabel={`You: ${MEMBER_STATE_LABEL[state]}`} style={[styles.dot, stateStyle(state, colors)]} />;
}

/**
 * One member on one verse in Who's where, a tile labelled for VoiceOver ("Dana, Romans 8:28,
 * Mastered"). Without a label it's the legend's swatch, hidden from VoiceOver.
 */
export function MemberStateSquare({ state, label }: { state: MemberState; label?: string }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View
      accessible={Boolean(label)}
      accessibilityLabel={label ? `${label}, ${MEMBER_STATE_LABEL[state]}` : undefined}
      style={[label ? styles.tile : styles.swatch, stateStyle(state, colors)]}
    />
  );
}

// The labels sit on leaf views: a card reads its children's labels, but not a label on a view with children.

/**
 * The group's count on a verse: "1/2" over a bar of every member's state (up to MAX_BAR_MEMBERS),
 * or "All" when everyone mastered it. `unavailable` when the grid couldn't be read.
 */
export function GroupCount({ states, unavailable }: { states: MemberState[] | null; unavailable: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  if (!states || states.length === 0) {
    return (
      <View style={styles.group}>
        <Text accessibilityLabel={unavailable ? 'Group: unavailable' : 'Group: loading'} style={[styles.count, { color: colors.icon }]}>
          –
        </Text>
      </View>
    );
  }
  const mastered = states.filter(isMasteredState).length;
  const all = mastered === states.length;
  const allEngraved = states.every((s) => s === 'engraved');
  const allColor = allEngraved ? colors.tint : colors.success;
  const segments = barSegments(states);
  return (
    <View style={styles.group}>
      <View style={styles.countRow}>
        {all && <IconSymbol name="checkmark" size={12} color={allColor} />}
        <Text
          accessibilityLabel={all ? `Group: everyone ${allEngraved ? 'engraved' : 'mastered'}` : `Group: ${mastered} of ${states.length} mastered`}
          style={[styles.count, { color: all ? allColor : colors.text }]}>
          {all ? 'All' : `${mastered}/${states.length}`}
        </Text>
      </View>
      {segments && (
        <View style={[styles.bar, { backgroundColor: colors.borderLight }]}>
          {segments.map((state, index) => (
            <View key={index} style={[styles.segment, { backgroundColor: memberStateFill(state, colors) }]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 12, height: 12, borderRadius: Radius.full },
  tile: { width: 20, height: 20, borderRadius: Radius.xs },
  swatch: { width: 12, height: 12, borderRadius: Radius.xs },
  group: { width: 44, alignItems: 'flex-end', gap: 5 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  count: { fontSize: 15, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bar: { flexDirection: 'row', width: 36, height: 4, borderRadius: Radius.xs, overflow: 'hidden' },
  segment: { flex: 1 },
});
