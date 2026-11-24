import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCountUp } from '@/hooks/use-count-up';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { useStreak } from '@/hooks/use-streak';
import { useWindowClass } from '@/hooks/use-window-class';
import { useInsightsStats } from '@/lib/store';
import { useRouter } from 'expo-router';
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface InsightsCardRef {
  refresh: () => Promise<void>;
}

export const InsightsCard = forwardRef<InsightsCardRef>(function InsightsCard(_, ref) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const openInsights = useDebouncedPress(() => router.push('/insights'));

  const stats = useInsightsStats();
  const { streak: rawStreak, refresh: refreshStreak } = useStreak();
  const streak = useCountUp(rawStreak);

  useImperativeHandle(ref, () => ({
    refresh: refreshStreak,
  }));
  const streakIcon = streak > 0 ? 'flame.fill' : 'snowflake';
  const streakColor = streak > 0 ? '#f97316' : '#60a5fa'; // Keep streak colors domain-specific
  const streakBg = streak > 0 ? 'rgba(249,115,22,0.15)' : 'rgba(96,165,250,0.15)';
  const streakGlyph = <IconSymbol name={streakIcon as any} size={28} color={streakColor} />;
  const windowClass = useWindowClass();

  // The open Duo: a white card with a cell per number. On its side the cells stack to fill the space beside the
  // monthly verse; upright they sit in one row under it.
  if (windowClass === 'wide' || windowClass === 'tall') {
    const wide = windowClass === 'wide';
    const rule = <View style={[wide ? styles.rule : styles.columnRule, { backgroundColor: colors.borderLight }]} />;
    return (
      <Pressable
        style={({ pressed }) => [
          styles.bigCard,
          { backgroundColor: colors.card, borderColor: colors.borderLight },
          wide ? styles.fill : styles.inRow,
          pressed && styles.cardPressed,
        ]}
        onPress={openInsights}
      >
        <StatRow icon={streakGlyph} iconBg={streakBg} value={streak} label="day streak" chevron={wide} />
        {rule}
        <StatRow icon={<IconSymbol name="book.fill" size={22} color={colors.tint} />} iconBg={colors.primaryLight} value={stats.versesMastered} label="mastered" />
        {rule}
        <StatRow icon={<IconSymbol name="arrow.up.right" size={22} color={colors.tint} />} iconBg={colors.primaryLight} value={stats.inProgress} label="in progress" />
        {!wide && <IconSymbol name="chevron.right" size={18} color={colors.icon} />}
      </Pressable>
    );
  }


  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { borderColor: colors.separator },
        pressed && styles.cardPressed,
      ]}
      onPress={openInsights}
    >
      <View style={styles.content}>
        {/* Streak Icon */}
        <View style={[styles.iconContainer, { backgroundColor: streakBg }]}>
          {streakGlyph}
        </View>

        {/* Stats */}
        <View style={styles.statsContainer}>
          <View style={styles.primaryStat}>
            <Text style={[styles.streakValue, { color: colors.text }]}>{streak}</Text>
            <Text style={[styles.streakLabel, { color: colors.icon }]}>day streak</Text>
          </View>
          <View style={styles.secondaryStats}>
            <View style={styles.stat}>
              <IconSymbol name="book.fill" size={14} color={colors.icon} />
              <Text style={[styles.statText, { color: colors.icon }]}>
                {stats.versesMastered} mastered
              </Text>
            </View>
            <View style={styles.stat}>
              <IconSymbol name="arrow.up.right" size={14} color={colors.icon} />
              <Text style={[styles.statText, { color: colors.icon }]}>
                {stats.inProgress} in progress
              </Text>
            </View>
          </View>
        </View>

        {/* Chevron */}
        <IconSymbol name="chevron.right" size={18} color={colors.icon} />
      </View>
    </Pressable>
  );
});

function StatRow({ icon, iconBg, value, label, chevron }: {
  icon: ReactNode;
  iconBg: string;
  value: number;
  label: string;
  chevron?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <View style={[styles.content, styles.bigRow]}>
      <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
        {icon}
      </View>
      <View style={[styles.statsContainer, styles.primaryStat]}>
        <Text style={[styles.streakValue, { color: colors.text }]}>{value}</Text>
        <Text style={[styles.streakLabel, { color: colors.icon }]}>{label}</Text>
      </View>
      {chevron && <IconSymbol name="chevron.right" size={18} color={colors.icon} />}
    </View>
  );
}

const styles = StyleSheet.create({
  bigCard: {
    borderWidth: 1,
    borderRadius: Radius.xxl,
    paddingHorizontal: 12,
    boxShadow: Shadows.card,
  },
  fill: { flexGrow: 1 },
  inRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Cells share the card evenly, down the card or across it.
  bigRow: { flexGrow: 1, flexBasis: 0 },
  rule: { height: 1 },
  columnRule: { width: 1, alignSelf: 'stretch', marginVertical: 14 },
  // A flat row between hairlines, like the rows in Library.
  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardPressed: {
    opacity: 0.6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 14,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    flex: 1,
    gap: 4,
  },
  primaryStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  streakValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  streakLabel: {
    fontSize: 14,
  },
  secondaryStats: {
    flexDirection: 'row',
    gap: 16,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statText: {
    fontSize: 13,
  },
});
