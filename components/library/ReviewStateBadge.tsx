import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { StyleSheet, Text, View } from 'react-native';

export type ReviewBadgeState =
  | { kind: 'locked'; daysUntilDue: number }
  | { kind: 'due' }
  | { kind: 'engraved'; lifetimeReviews: number }
  | { kind: 'none' };

interface ReviewStateBadgeProps {
  state: ReviewBadgeState;
}

export function ReviewStateBadge({ state }: ReviewStateBadgeProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  if (state.kind === 'none') return null;

  if (state.kind === 'locked') {
    const label =
      state.daysUntilDue <= 0
        ? 'Due soon'
        : state.daysUntilDue === 1
        ? 'Next review tomorrow'
        : `Next review in ${state.daysUntilDue}d`;
    return (
      <View style={styles.row}>
        <Text style={[styles.lockedText, { color: colors.icon }]}>{label}</Text>
      </View>
    );
  }

  if (state.kind === 'due') {
    return (
      <View style={[styles.duePill, { backgroundColor: colors.tint }]}>
        <Text style={styles.dueText}>Review now</Text>
      </View>
    );
  }

  // engraved
  return (
    <View style={styles.row}>
      <EngravedIcon size={12} color={colors.tint} />
      <Text style={[styles.engravedText, { color: colors.tint }]}>
        {state.lifetimeReviews} {state.lifetimeReviews === 1 ? 'review' : 'reviews'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  lockedText: {
    fontSize: 12,
    fontWeight: '500',
  },
  duePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  dueText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  engravedText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
