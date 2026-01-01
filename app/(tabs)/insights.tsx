import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useStreak } from '@/hooks/use-streak';
import { getAvgTimeToMaster, getTotalTimeStudied } from '@/lib/api';
import { useInsightsStats, useMostMemorizedBooks } from '@/lib/store';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface StatCardProps {
  value: number | string;
  label: string;
  icon: string;
  iconBgColor: string;
  iconColor: string;
  onInfoPress?: () => void;
}

function StatCard({ value, label, icon, iconBgColor, iconColor, onInfoPress }: StatCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const cardBg = isDark ? '#1e1e1e' : '#f5f5f5';

  return (
    <View style={[styles.statCard, { backgroundColor: cardBg }]}>
      <View style={styles.statLabelRow}>
        <Text style={[styles.statLabel, { color: colors.icon }]}>{label}</Text>
        {onInfoPress && (
          <Pressable onPress={onInfoPress} hitSlop={8}>
            <IconSymbol name="info.circle" size={16} color={colors.icon} />
          </Pressable>
        )}
      </View>
      <View style={styles.statRow}>
        <View style={[styles.iconContainer, { backgroundColor: iconBgColor }]}>
          <IconSymbol name={icon as any} size={18} color={iconColor} />
        </View>
        <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * Format milliseconds to hours and minutes
 * - Under 100 hours: "Xh Ym" format (rounding seconds up to next minute)
 * - 100+ hours: "X.Xh" format (rounded to nearest 0.1h, .05 rounds up)
 */
function formatTimeStudied(ms: number): string {
  if (ms === 0) return '0m';

  const totalHours = ms / 3600000;

  if (totalHours >= 100) {
    // Round to nearest 0.1h (.05 rounds up)
    const rounded = Math.round(totalHours * 10) / 10;
    // Show decimal only if non-zero
    if (rounded % 1 === 0) {
      return `${rounded}h`;
    }
    return `${rounded.toFixed(1)}h`;
  }

  // Under 100 hours: show hours and minutes
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Format milliseconds to minutes and seconds (for avg time to master)
 * - Under 100 minutes: "Xm Ys" format (rounding ms up to next second)
 * - 100+ minutes: "X.Xm" format (rounded to nearest 0.1m)
 */
function formatAvgTime(ms: number): string {
  if (ms === 0) return '0s';

  const totalMinutes = ms / 60000;

  if (totalMinutes >= 100) {
    // Round to nearest 0.1m (.05 rounds up)
    const rounded = Math.round(totalMinutes * 10) / 10;
    // Show decimal only if non-zero
    if (rounded % 1 === 0) {
      return `${rounded}m`;
    }
    return `${rounded.toFixed(1)}m`;
  }

  // Under 100 minutes: show minutes and seconds
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  if (seconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
}

export default function InsightsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const stats = useInsightsStats();
  const topBooks = useMostMemorizedBooks();
  const { streak } = useStreak();
  const [timeStudiedMs, setTimeStudiedMs] = useState(0);
  const [avgTimeToMasterMs, setAvgTimeToMasterMs] = useState<number | null>(null);
  const [showTimeStudiedInfo, setShowTimeStudiedInfo] = useState(false);
  const [showAvgTimeInfo, setShowAvgTimeInfo] = useState(false);

  useEffect(() => {
    getTotalTimeStudied().then(setTimeStudiedMs);
    getAvgTimeToMaster().then(setAvgTimeToMasterMs);
  }, []);

  const streakIcon = streak > 0 ? 'flame.fill' : 'snowflake';
  const streakColor = streak > 0 ? '#f97316' : '#60a5fa';
  const streakBg = streak > 0 ? 'rgba(249,115,22,0.15)' : 'rgba(96,165,250,0.15)';
  const streakMessage = streak > 0 ? 'Keep it going!' : 'Start practicing to build your streak!';

  const cardBg = isDark ? '#1e1e1e' : '#f5f5f5';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Insights" />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Hero Stats */}
        <View style={styles.statsRow}>
          <StatCard
            value={stats.versesMastered}
            label="Verses Mastered"
            icon="checkmark.circle.fill"
            iconBgColor="rgba(34,197,94,0.15)"
            iconColor="#22c55e"
          />
          <StatCard
            value={stats.inProgress}
            label="Verses In Progress"
            icon="clock.fill"
            iconBgColor="rgba(59,130,246,0.15)"
            iconColor="#3b82f6"
          />
        </View>

        {/* Practice Streak */}
        <View style={[styles.streakCard, { backgroundColor: cardBg }]}>
          <View style={[styles.streakIconContainer, { backgroundColor: streakBg }]}>
            <IconSymbol name={streakIcon as any} size={32} color={streakColor} />
          </View>
          <View style={styles.streakInfo}>
            <Text style={[styles.streakLabel, { color: colors.icon }]}>Practice Streak</Text>
            <Text style={[styles.streakValue, { color: colors.text }]}>
              {streak} {streak === 1 ? 'day' : 'days'}
            </Text>
            <Text style={[styles.streakMessage, { color: colors.icon }]}>{streakMessage}</Text>
          </View>
        </View>

        {/* Time Stats */}
        <View style={styles.statsRow}>
          <StatCard
            value={formatTimeStudied(timeStudiedMs)}
            label="Time Studied"
            icon="clock.fill"
            iconBgColor="rgba(168,85,247,0.15)"
            iconColor="#a855f7"
            onInfoPress={() => setShowTimeStudiedInfo(true)}
          />
          <StatCard
            value={avgTimeToMasterMs !== null ? formatAvgTime(avgTimeToMasterMs) : '--'}
            label="Time to Master Verse"
            icon="chart.line.uptrend.xyaxis"
            iconBgColor="rgba(236,72,153,0.15)"
            iconColor="#ec4899"
            onInfoPress={() => setShowAvgTimeInfo(true)}
          />
        </View>

        {/* Most Memorized Books */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.icon }]}>MOST MEMORIZED BOOKS</Text>
          <View style={[styles.booksList, { backgroundColor: cardBg }]}>
            {topBooks.length > 0 ? (
              topBooks.map((book, index) => (
                <View
                  key={book.name}
                  style={[
                    styles.bookItem,
                    index < topBooks.length - 1 && styles.bookItemBorder,
                    { borderBottomColor: isDark ? '#333' : '#e5e5e5' },
                  ]}
                >
                  <View style={styles.bookInfo}>
                    <View style={[styles.bookIcon, { backgroundColor: isDark ? '#333' : '#e5e5e5' }]}>
                      <IconSymbol name="book.fill" size={18} color={colors.icon} />
                    </View>
                    <Text style={[styles.bookName, { color: colors.text }]}>{book.name}</Text>
                  </View>
                  <Text style={[styles.bookCount, { color: colors.icon }]}>({book.count})</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyBooks}>
                <Text style={[styles.emptyText, { color: colors.icon }]}>No verses memorized yet</Text>
                <Text style={[styles.emptySubtext, { color: colors.icon }]}>
                  Start practicing to see your progress!
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Time Studied Info Modal */}
      <Modal
        visible={showTimeStudiedInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTimeStudiedInfo(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowTimeStudiedInfo(false)}
        >
          <View
            style={[styles.modalContent, { backgroundColor: isDark ? '#2a2a2a' : '#fff' }]}
            onStartShouldSetResponder={() => true}
          >
            <Pressable style={styles.modalClose} onPress={() => setShowTimeStudiedInfo(false)} hitSlop={8}>
              <IconSymbol name="xmark" size={18} color={colors.icon} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Time Studied</Text>
            <Text style={[styles.modalText, { color: colors.icon }]}>
              Total Recording Time, across all attempts and verses.
            </Text>
          </View>
        </Pressable>
      </Modal>

      {/* Avg Time to Master Info Modal */}
      <Modal
        visible={showAvgTimeInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAvgTimeInfo(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setShowAvgTimeInfo(false)}
        >
          <View
            style={[styles.modalContent, { backgroundColor: isDark ? '#2a2a2a' : '#fff' }]}
            onStartShouldSetResponder={() => true}
          >
            <Pressable style={styles.modalClose} onPress={() => setShowAvgTimeInfo(false)} hitSlop={8}>
              <IconSymbol name="xmark" size={18} color={colors.icon} />
            </Pressable>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Time to Master One Verse</Text>
            <Text style={[styles.modalText, { color: colors.icon }]}>
              Your average practice time to master one verse (23 words).
            </Text>
            <View style={styles.formulaContainer}>
              <View style={styles.fraction}>
                <Text style={[styles.formulaText, { color: colors.icon }]}>
                  Recording Time <Text style={{ fontStyle: 'italic' }}>until mastery</Text>
                </Text>
                <View style={[styles.fractionLine, { backgroundColor: colors.icon }]} />
                <Text style={[styles.formulaText, { color: colors.icon }]}>Words Mastered</Text>
              </View>
              <Text style={[styles.formulaMultiplier, { color: colors.icon }]}>× 23</Text>
            </View>
            <Text style={[styles.modalText, { color: colors.icon }]}>
              Data point requires 600+ words mastered!
            </Text>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    gap: 6,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 13,
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    borderRadius: 12,
    gap: 16,
  },
  streakIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakInfo: {
    flex: 1,
    gap: 4,
  },
  streakLabel: {
    fontSize: 13,
  },
  streakValue: {
    fontSize: 28,
    fontWeight: '700',
  },
  streakMessage: {
    fontSize: 13,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  booksList: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  bookItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  bookItemBorder: {
    borderBottomWidth: 1,
  },
  bookInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bookIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bookName: {
    fontSize: 16,
    fontWeight: '500',
  },
  bookCount: {
    fontSize: 15,
  },
  emptyBooks: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 4,
  },
  statLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
    paddingTop: 16,
    gap: 12,
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  formulaContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginVertical: 8,
  },
  fraction: {
    alignItems: 'center',
  },
  fractionLine: {
    height: 1,
    width: '100%',
    marginVertical: 4,
  },
  formulaText: {
    fontSize: 13,
    textAlign: 'center',
  },
  formulaMultiplier: {
    fontSize: 15,
    fontWeight: '500',
  },
});
