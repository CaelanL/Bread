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

/** One solid fill per state, for tiles and the legend. Open is the surface one step up. */
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
 * The group's count on a verse, the same on every row: members who mastered it (engraved counts)
 * over all members. `unavailable` when the grid couldn't be read.
 */
export function GroupCount({ states, unavailable }: { states: MemberState[] | null; unavailable: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  if (!states || states.length === 0) {
    return (
      <Text accessibilityLabel={unavailable ? 'Group: unavailable' : 'Group: loading'} style={[styles.count, { color: colors.icon }]}>
        –
      </Text>
    );
  }
  const mastered = states.filter(isMasteredState).length;
  return (
    <Text accessibilityLabel={`Group: ${mastered} of ${states.length} mastered`} style={[styles.count, { color: colors.text }]}>
      {mastered}/{states.length}
    </Text>
  );
}

const styles = StyleSheet.create({
  tile: { width: 20, height: 20, borderRadius: Radius.xs },
  swatch: { width: 12, height: 12, borderRadius: Radius.xs },
  count: { fontSize: 15, lineHeight: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
