import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCountUp } from '@/hooks/use-count-up';
import { useStreak } from '@/hooks/use-streak';
import { useInsightsStats } from '@/lib/store';
import { useRouter } from 'expo-router';
import { forwardRef, useImperativeHandle } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface InsightsCardRef {
  refresh: () => Promise<void>;
}

export const InsightsCard = forwardRef<InsightsCardRef>(function InsightsCard(_, ref) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const router = useRouter();

  const stats = useInsightsStats();
  const { streak: rawStreak, refresh: refreshStreak } = useStreak();
  const streak = useCountUp(rawStreak);

  useImperativeHandle(ref, () => ({
    refresh: refreshStreak,
  }));
  const streakIcon = streak > 0 ? 'flame.fill' : 'snowflake';
  const streakColor = streak > 0 ? '#f97316' : '#60a5fa'; // Keep streak colors domain-specific
  const streakBg = streak > 0 ? 'rgba(249,115,22,0.15)' : 'rgba(96,165,250,0.15)';

  const cardBg = colors.card;
  const borderColor = isDark ? 'rgba(201,169,98,0.3)' : 'rgba(176,141,87,0.25)'; // Bronze gold accent border

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: cardBg, borderColor },
        pressed && styles.cardPressed,
      ]}
      onPress={() => router.push('/insights')}
    >
      <View style={styles.content}>
        {/* Streak Icon */}
        <View style={[styles.iconContainer, { backgroundColor: streakBg }]}>
          <IconSymbol name={streakIcon as any} size={28} color={streakColor} />
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

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.99 }],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
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
