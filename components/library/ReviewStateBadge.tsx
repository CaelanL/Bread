/**
 * Per-verse review state pill. Renders inline in the verse card body to
 * signal where the verse stands in the SR cycle:
 *
 *   pre-mastery  →  null         (verse hasn't entered SR yet)
 *   locked       →  "Next review tmr" / "Next review in 1d 5h" / "Next review in 30d"
 *   due          →  "Review now"
 *   engraved     →  EngravedIcon + "47 reviews" lifetime count
 *
 * Engraved is sticky: an engraved verse that is also due renders the
 * Engraved variant. Due-ness on engraved verses is communicated via sort
 * position (Mastered's "due-first" sort), not a second badge.
 */

import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReviewNowValue } from '@/hooks/use-review-now';
import { formatTimeUntilDue } from '@/lib/store/review';
import type { SavedVerse } from '@/lib/storage';
import { StyleSheet, Text, View } from 'react-native';

interface Props {
  verse: SavedVerse;
}

export function ReviewStateBadge({ verse }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const now = useReviewNowValue();

  const e = verse.progress.engraved;
  const masteredOnHard = verse.progress.hard?.completed === true;

  if (!masteredOnHard) return null;

  // Engraved wins.
  if (e?.completed) {
    return (
      <View style={[styles.badge, styles.engravedBadge, { backgroundColor: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.12)' }]}>
        <EngravedIcon size={11} color={colors.tint} />
        <Text style={[styles.label, { color: colors.tint }]}>
          {e.lifetimeReviews} {e.lifetimeReviews === 1 ? 'review' : 'reviews'}
        </Text>
      </View>
    );
  }

  const isDue =
    !e ||
    e.nextDueAt === null ||
    now.getTime() >= new Date(e.nextDueAt).getTime();

  if (isDue) {
    return (
      <View style={[styles.badge, { backgroundColor: colors.tint }]}>
        <Text style={[styles.label, { color: '#ffffff', fontWeight: '600' }]}>Review now</Text>
      </View>
    );
  }

  // Locked. "tmr" reads as a standalone clause ("Next review tmr"); other
  // labels read as durations ("Next review in 3d", "Next review in 1d 5h").
  const diffMs = new Date(e!.nextDueAt!).getTime() - now.getTime();
  const label = formatTimeUntilDue(diffMs);
  const text = label === 'tmr' ? 'Next review tmr' : `Next review in ${label}`;
  return (
    <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
      <Text style={[styles.label, { color: colors.icon }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 4,
  },
  engravedBadge: {
    // engraved variant uses a softer warm fill; tint comes from text color
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
});
