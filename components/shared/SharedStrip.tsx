import { MemberDots } from '@/components/shared/MemberDots';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export type GroupProgressValue = { ratio: number; masteredByEveryone: number };

/** "Group progress 50%. 1 of 3 verses mastered by everyone", or the loading label. */
export function groupProgressLabel(progress: GroupProgressValue | null, verseCount: number): string {
  if (!progress) return 'Group progress loading';
  if (verseCount === 0) return 'Group progress. No verses yet';
  return `Group progress ${Math.round(progress.ratio * 100)}%. ${progress.masteredByEveryone} of ${plural(verseCount, 'verse')} mastered by everyone`;
}

/**
 * The group card under a shared collection's header: members and the owner's name (opens the
 * member list), a gear (opens the share panel), and the group's progress (mastered squares over
 * all squares). The rest of the card opens Who's where; a failed grid read shows Retry instead.
 */
export function SharedStrip({ ownerName, members, memberCount, verseCount, progress, failed, onMembers, onSettings, onShowGrid, onRetry }: {
  /** Null until the grid's first read. */
  ownerName: string | null;
  /** Yours first. Null until the grid's first read. */
  members: { name: string; you: boolean }[] | null;
  memberCount: number;
  verseCount: number;
  /** Null while the grid loads. */
  progress: GroupProgressValue | null;
  failed: boolean;
  onMembers: () => void;
  onSettings: () => void;
  onShowGrid: () => void;
  onRetry: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const percent = progress ? Math.round(progress.ratio * 100) : 0;
  const heading = [ownerName, plural(memberCount, 'member'), verseCount === 0 ? 'No verses yet' : plural(verseCount, 'verse')]
    .filter(Boolean).join(' · ');

  return (
    <View style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Pressable
          testID="shared-row"
          accessibilityRole="button"
          accessibilityLabel={`${heading}. Show members`}
          onPress={onMembers}
          style={styles.membersLine}
        >
          {members && <MemberDots members={members} count={memberCount} />}
          <Text style={[styles.members, { color: colors.icon }]} numberOfLines={1}>
            {heading}
          </Text>
        </Pressable>
        <Pressable
          testID="shared-settings"
          accessibilityRole="button"
          accessibilityLabel="Sharing settings"
          onPress={onSettings}
          hitSlop={8}
          style={styles.gear}
        >
          <IconSymbol name="gearshape" size={18} color={colors.icon} />
        </Pressable>
      </View>

      {failed && !progress ? (
        <Pressable testID="shared-progress-retry" accessibilityRole="button" accessibilityLabel="Couldn't load group progress. Retry"
          onPress={onRetry} style={[styles.body, styles.retry]}>
          <Text style={[styles.summary, { color: colors.text }]}>Couldn&apos;t load group progress.</Text>
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      ) : (
        <Pressable
          testID="shared-progress"
          accessibilityRole="button"
          accessibilityLabel={groupProgressLabel(progress, verseCount)}
          accessibilityHint="Shows details"
          onPress={onShowGrid}
          style={[styles.body, styles.progress]}
        >
          <View style={styles.progressTop}>
            <Text style={[styles.label, { color: colors.text }]}>Group progress</Text>
            {progress ? (
              <Text style={[styles.percent, { color: colors.text }]}>{percent}%</Text>
            ) : (
              <ActivityIndicator size="small" color={colors.icon} />
            )}
          </View>
          <View style={[styles.track, { backgroundColor: colors.borderLight }]}>
            <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.success }]} />
          </View>
          <View style={styles.details}>
            <Text style={[styles.summary, { color: colors.icon }]}>Details</Text>
            <IconSymbol name="chevron.right" size={14} color={colors.icon} />
          </View>
        </Pressable>
      )}
      {failed && progress && (
        <Pressable testID="shared-progress-retry" accessibilityRole="button" accessibilityLabel="Couldn't refresh group progress. Retry"
          onPress={onRetry} style={[styles.body, styles.staleRetry]}>
          <Text style={[styles.summary, { color: colors.icon }]}>Couldn&apos;t refresh.</Text>
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

// The card's padding sits inside its pressable parts, so every point of the card answers a tap.
const styles = StyleSheet.create({
  strip: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    paddingBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center' },
  membersLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingTop: 12 },
  members: { flex: 1, fontSize: 13, lineHeight: 18 },
  gear: { paddingHorizontal: 14, paddingTop: 12 },
  body: { paddingHorizontal: 14, paddingTop: 12 },
  progress: { gap: 8 },
  progressTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontSize: 15, lineHeight: 20 },
  percent: { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  summary: { fontSize: 13, lineHeight: 18 },
  details: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  retry: { gap: 4, paddingBottom: 4 },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  staleRetry: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
