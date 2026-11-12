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
  return `Group progress ${Math.round(progress.ratio * 100)}%. ${progress.masteredByEveryone} of ${plural(verseCount, 'verse')} mastered by everyone`;
}

/**
 * Under a shared collection's header: members, then the group's progress (mastered squares over
 * all squares). The members line opens `onOpen` (the members sheet), the progress `onShowGrid`
 * (Who's where); a failed grid read shows Retry instead of the numbers.
 */
export function SharedStrip({ members, memberCount, verseCount, progress, failed, onOpen, onShowGrid, onRetry }: {
  /** Yours first. Null until the grid's first read. */
  members: { name: string; you: boolean }[] | null;
  memberCount: number;
  verseCount: number;
  /** Null while the grid loads. */
  progress: GroupProgressValue | null;
  failed: boolean;
  onOpen: () => void;
  onShowGrid: () => void;
  onRetry: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const percent = progress ? Math.round(progress.ratio * 100) : 0;
  const heading = `Shared · ${plural(memberCount, 'member')} · ${plural(verseCount, 'verse')}`;
  const summary = progress ? `${progress.masteredByEveryone} of ${plural(verseCount, 'verse')} mastered by everyone` : '';

  return (
    <View style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        testID="shared-row"
        accessibilityRole="button"
        accessibilityLabel={`${heading}. Show members`}
        onPress={onOpen}
        style={styles.header}
      >
        {members && <MemberDots members={members} count={memberCount} />}
        <Text style={[styles.members, { color: colors.icon }]} numberOfLines={1}>
          {heading}
        </Text>
        <IconSymbol name="chevron.right" size={14} color={colors.icon} />
      </Pressable>

      {failed && !progress ? (
        <Pressable testID="shared-progress-retry" accessibilityRole="button" accessibilityLabel="Couldn't load group progress. Retry"
          onPress={onRetry} style={styles.retry}>
          <Text style={[styles.summary, { color: colors.text }]}>Couldn&apos;t load group progress.</Text>
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      ) : (
        <Pressable
          testID="shared-progress"
          accessibilityRole="button"
          accessibilityLabel={groupProgressLabel(progress, verseCount)}
          accessibilityHint="Shows who's where"
          onPress={onShowGrid}
          style={styles.progress}
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
          <View style={styles.summaryRow}>
            <Text style={[styles.summary, styles.summaryText, { color: colors.icon }]} numberOfLines={1}>{summary || ' '}</Text>
            <Text style={[styles.summary, { color: colors.icon }]}>Who&apos;s where</Text>
            <IconSymbol name="chevron.right" size={14} color={colors.icon} />
          </View>
        </Pressable>
      )}
      {failed && progress && (
        <Pressable testID="shared-progress-retry" accessibilityRole="button" accessibilityLabel="Couldn't refresh group progress. Retry"
          onPress={onRetry} style={styles.staleRetry}>
          <Text style={[styles.summary, { color: colors.icon }]}>Couldn&apos;t refresh.</Text>
          <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  members: { flex: 1, fontSize: 13, lineHeight: 18 },
  progress: { gap: 8 },
  progressTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontSize: 15, lineHeight: 20 },
  percent: { fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  summary: { fontSize: 13, lineHeight: 18 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryText: { flex: 1 },
  retry: { gap: 4, paddingVertical: 4 },
  retryText: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  staleRetry: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
