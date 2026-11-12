import { MemberDots } from '@/components/shared/MemberDots';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Under a shared collection's header: members, then the group's progress (mastered squares over
 * all squares). Tapping opens `onOpen`; a failed grid read shows Retry instead of the numbers.
 */
export function SharedStrip({ memberNames, memberCount, verseCount, progress, failed, onOpen, onRetry }: {
  memberNames: string[] | null;
  memberCount: number;
  verseCount: number;
  /** Null while the grid loads. */
  progress: { ratio: number; masteredByEveryone: number } | null;
  failed: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const percent = progress ? Math.round(progress.ratio * 100) : 0;
  const summary = progress ? `${progress.masteredByEveryone} of ${plural(verseCount, 'verse')} mastered by everyone` : '';

  return (
    <View style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Pressable
        testID="shared-row"
        accessibilityRole="button"
        accessibilityLabel={`Shared, ${plural(memberCount, 'member')}, ${plural(verseCount, 'verse')}. Show members`}
        onPress={onOpen}
        style={styles.header}
      >
        {memberNames && <MemberDots names={memberNames} count={memberCount} />}
        <Text style={[styles.members, { color: colors.icon }]} numberOfLines={1}>
          {plural(memberCount, 'member')} · {plural(verseCount, 'verse')}
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
          accessibilityLabel={progress ? `Group progress ${percent}%. ${summary}` : 'Group progress loading'}
          onPress={onOpen}
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
          <Text style={[styles.summary, { color: colors.icon }]}>{summary || ' '}</Text>
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
  members: { flex: 1, fontSize: 13, fontWeight: '500' },
  progress: { gap: 8 },
  progressTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '500' },
  percent: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: Radius.full },
  summary: { fontSize: 13 },
  retry: { gap: 4, paddingVertical: 4 },
  retryText: { fontSize: 14, fontWeight: '600' },
  staleRetry: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
