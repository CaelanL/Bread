import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { VerseProgress } from '@/lib/storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ProgressInfoButton, ProgressInfoModal } from './ProgressInfoModal';

interface ProgressCardProps {
  progress: VerseProgress;
}

type Difficulty = 'easy' | 'medium' | 'hard';

const difficultyLabels: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

/**
 * Convert "YYYY-MM" to short month name (e.g., "Jan")
 */
function getMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { month: 'short' });
}

/**
 * Convert "YYYY-MM" to elegant date format (e.g., "December 2024")
 */
function getEngravedDate(monthStr: string): string {
  const [year, month] = monthStr.split('-').map(Number);
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Get future month label based on offset from a starting month
 * If lastMonth provided, calculates consecutive months after it
 * Otherwise starts from current month
 */
function getFutureMonthLabel(offset: number, lastMonth?: string): string {
  let date: Date;

  if (lastMonth) {
    // Start from the month after lastMonth
    const [year, month] = lastMonth.split('-').map(Number);
    date = new Date(year, month - 1); // month is 0-indexed
    date.setMonth(date.getMonth() + offset + 1); // +1 to get next month
  } else {
    // No completed months, start from current month
    date = new Date();
    date.setMonth(date.getMonth() + offset);
  }

  return date.toLocaleDateString('en-US', { month: 'short' });
}

export function ProgressCard({ progress }: ProgressCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  const getScore = (difficulty: Difficulty): number | null => {
    return progress[difficulty]?.bestAccuracy ?? null;
  };

  // Engraved section always shows
  const engraved = progress.engraved || { completed: false, months: [] };
  const isFullyEngraved = engraved.completed;

  // Colors for engraved section
  const isDark = colorScheme === 'dark';
  const silverColor = '#9ca3af'; // Gray/silver for in-progress
  const goldColor = colors.tint; // App's bronze gold for 4/4 completed
  const unfilledColor = isDark ? '#514f4fff' : colors.border; // Lighter in dark mode for visibility

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.text }]}>Your Progress</Text>
        <ProgressInfoButton onPress={() => setInfoModalVisible(true)} />
      </View>

      <ProgressInfoModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
      />

      <View style={[styles.card, { backgroundColor: colors.cardAlt, borderColor: colors.borderLight }]}>
        {/* Best scores - Horizontal columns with dividers */}
        <View style={styles.scoresRow}>
          {(['easy', 'medium', 'hard'] as Difficulty[]).map((difficulty, index) => {
            const score = getScore(difficulty);
            const isLast = index === 2;
            const isCompleted = progress[difficulty]?.completed === true;

            return (
              <View
                key={difficulty}
                style={[
                  styles.scoreColumn,
                  !isLast && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
                ]}
              >
                <Text style={[styles.scoreLabel, { color: colors.icon }]}>
                  {difficultyLabels[difficulty]}
                </Text>
                <Text style={[
                  styles.scoreValue,
                  {
                    color: isCompleted
                      ? colors.success
                      : score !== null
                        ? colors.warning
                        : colors.icon
                  },
                  score === null && styles.scoreValueMuted,
                ]}>
                  {score !== null ? `${score}%` : '—'}
                  {isCompleted && ' ✓'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Engraved Progress Section */}
        <View style={[
            styles.engravedSection,
            { borderTopColor: isFullyEngraved ? 'rgba(245, 158, 11, 0.3)' : colors.borderLight },
            isFullyEngraved && styles.engravedSectionGlow,
          ]}>
            {/* Header */}
            <View style={styles.engravedHeader}>
              <Text style={[
                styles.engravedLabel,
                { color: isFullyEngraved ? goldColor : colors.icon },
              ]}>
                {isFullyEngraved ? 'Engraved' : 'Engraved Progress'}
              </Text>
              {isFullyEngraved ? (
                <EngravedIcon size={16} color={goldColor} />
              ) : (
                <MaterialCommunityIcons name="cross" size={16} color={silverColor} />
              )}
            </View>

            {/* Progress circles with connecting line */}
            <View style={styles.circlesContainer}>
              {/* Background line (unfilled) */}
              <View style={[
                styles.connectingLine,
                { backgroundColor: unfilledColor },
              ]} />
              {/* Filled line (only spans completed circles) */}
              {engraved.months.length > 1 && (
                <View style={[
                  styles.connectingLine,
                  { backgroundColor: isFullyEngraved ? goldColor : silverColor },
                  // For partial fill (less than 4), override right to stop at last completed circle
                  engraved.months.length < 4 && styles.connectingLinePartial,
                  engraved.months.length === 2 && { right: '66.7%' },
                  engraved.months.length === 3 && { right: '33.3%' },
                ]} />
              )}

              {/* 4 circles */}
              {Array.from({ length: 4 }).map((_, i) => {
                const isCompleted = i < engraved.months.length;
                const monthLabel = engraved.months[i];
                const isGolden = isFullyEngraved && isCompleted;

                return (
                  <View key={i} style={styles.circleWrapper}>
                    <View style={[
                      styles.circle,
                      isGolden
                        ? { backgroundColor: goldColor, borderColor: goldColor }
                        : isCompleted
                          ? { backgroundColor: silverColor, borderColor: silverColor }
                          : { backgroundColor: colors.cardAlt, borderColor: unfilledColor },
                    ]}>
                      {isCompleted && (
                        <MaterialCommunityIcons name="check" size={12} color="#fff" />
                      )}
                    </View>
                    {/* Hide month labels when fully engraved */}
                    {!isFullyEngraved && (
                      <Text style={[
                        styles.monthLabel,
                        { color: colors.icon },
                      ]}>
                        {monthLabel
                          ? getMonthLabel(monthLabel)
                          : getFutureMonthLabel(i - engraved.months.length, engraved.months[engraved.months.length - 1])}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>

            {/* Tagline and engraved date when fully engraved */}
            {isFullyEngraved && (
              <>
                <Text style={[styles.tagline, { color: goldColor }]}>
                  "I have hidden your word in my heart"
                </Text>
                {engraved.months[3] && (
                  <View style={styles.engravedDateRow}>
                    <View style={[styles.engravedDateLine, { backgroundColor: goldColor }]} />
                    <Text style={[styles.engravedDateText, { color: goldColor }]}>
                      Engraved {getEngravedDate(engraved.months[3])}
                    </Text>
                    <View style={[styles.engravedDateLine, { backgroundColor: goldColor }]} />
                  </View>
                )}
              </>
            )}
          </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  scoresRow: {
    flexDirection: 'row',
  },
  scoreColumn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
  },
  scoreLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: '600',
  },
  scoreValueMuted: {
    opacity: 0.5,
  },
  engravedSection: {
    borderTopWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  engravedSectionGlow: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  engravedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 16,
  },
  engravedLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  circlesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    position: 'relative',
  },
  connectingLine: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: 12,
    height: 2,
    borderRadius: 1,
  },
  connectingLinePartial: {
    right: undefined,
  },
  circleWrapper: {
    alignItems: 'center',
    gap: 6,
    zIndex: 1,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    fontSize: 10,
  },
  tagline: {
    textAlign: 'center',
    fontSize: 10,
    marginTop: 12,
    letterSpacing: 0.3,
  },
  engravedDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    gap: 8,
  },
  engravedDateLine: {
    height: 1,
    width: 24,
    opacity: 0.4,
  },
  engravedDateText: {
    fontSize: 10,
    fontFamily: 'Times New Roman',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
});
