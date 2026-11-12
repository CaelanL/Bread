import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, MonthlyCardColors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Emblem } from '@/lib/shared/progress';
import { StyleSheet, View } from 'react-native';

const RING_WIDTH = 1.5;
// Ring stroke plus the same width of card showing between ring and square.
const RING_INSET = RING_WIDTH * 2;

/**
 * A Library card's icon square for a mastered or engraved collection. `ring` (shared, everyone
 * done) draws a second ring around it outside the square's box, so the card's layout doesn't move.
 */
export function CollectionEmblem({ emblem, ring }: { emblem: Emblem; ring: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const engraved = emblem === 'engraved';
  const color = engraved ? colors.tint : colors.success;

  return (
    <View style={[styles.square, { backgroundColor: engraved ? colors.primaryLight : MonthlyCardColors.masteredPlain }]}>
      {ring && <View style={[styles.ring, { borderColor: color }]} />}
      {engraved
        ? <EngravedIcon size={24} color={color} />
        : <IconSymbol name="checkmark" size={24} color={color} />}
    </View>
  );
}

const styles = StyleSheet.create({
  square: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    top: -RING_INSET,
    left: -RING_INSET,
    right: -RING_INSET,
    bottom: -RING_INSET,
    borderWidth: RING_WIDTH,
    borderRadius: Radius.xl,
  },
});
