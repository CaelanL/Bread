import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { VerseProgress } from '@/lib/storage';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { ProgressInfoButton, ProgressInfoModal } from './ProgressInfoModal';

const ENGRAVED_THRESHOLD = 10;

interface ProgressCardProps {
  progress: VerseProgress;
  /** SPIKE-only: stable id used to derive a fake review state so different verses show different variants */
  verseIdForSpike?: string;
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

type Difficulty = 'easy' | 'medium' | 'hard';

const difficultyLabels: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

export function ProgressCard({ progress, verseIdForSpike }: ProgressCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  const getScore = (difficulty: Difficulty): number | null => {
    return progress[difficulty]?.bestAccuracy ?? null;
  };

  // Engraved section always shows
  const engraved = progress.engraved || { completed: false, months: [] };
  // SPIKE: passCount is not yet on the type. Fall back to legacy months.length until migration.
  const passCount = ((engraved as unknown) as { passCount?: number }).passCount
    ?? engraved.months.length;
  const lifetimeReviews = ((engraved as unknown) as { lifetimeReviews?: number }).lifetimeReviews
    ?? engraved.months.length;
  const isFullyEngraved = passCount >= ENGRAVED_THRESHOLD || engraved.completed;
  const progressPct = Math.min(100, (passCount / ENGRAVED_THRESHOLD) * 100);

  // SPIKE: fake review state so different verses preview different variants.
  // Driven by a hash of the verse id when provided — stable across reloads,
  // varies between verses so you can see Locked + Due on different cards.
  const isMastered = progress.hard?.completed === true;
  type SpikeStatus =
    | { kind: 'pre' }
    | { kind: 'locked'; hoursUntilDue: number; daysUntilDue: number }
    | { kind: 'due' }
    | { kind: 'engraved' };

  const spikeBucket = verseIdForSpike ? hashId(verseIdForSpike) % 4 : 0;
  // Buckets:
  //  0 → Locked, ~14 hours until due (sub-24h countdown)
  //  1 → Locked, ~3 days until due
  //  2 → Due (ready)
  //  3 → Due (ready) — duplicated so 50% land on Due
  const fakeStatus: SpikeStatus = !isMastered
    ? { kind: 'pre' }
    : isFullyEngraved
      ? { kind: 'engraved' }
      : spikeBucket === 0
        ? { kind: 'locked', hoursUntilDue: 14, daysUntilDue: 0 }
        : spikeBucket === 1
          ? { kind: 'locked', hoursUntilDue: 0, daysUntilDue: 3 }
          : { kind: 'due' };

  const isLocked = fakeStatus.kind === 'locked';
  const isDue = fakeStatus.kind === 'due';

  // Colors for engraved section
  const isDark = colorScheme === 'dark';
  const goldColor = colors.tint;
  const unfilledColor = isDark ? '#514f4fff' : colors.border;

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
            {
              borderTopColor: isFullyEngraved
                ? 'rgba(245, 158, 11, 0.3)'
                : colors.borderLight,
            },
            isFullyEngraved && styles.engravedSectionGlow,
            isLocked && styles.lockedSection,
            isDue && styles.dueSection,
          ]}>
            {/* Header */}
            <View style={styles.engravedHeader}>
              <Text style={[
                styles.engravedLabel,
                {
                  color: isFullyEngraved
                    ? goldColor
                    : isLocked
                      ? colors.icon
                      : isDue
                        ? goldColor
                        : colors.icon,
                },
              ]}>
                {isFullyEngraved
                  ? 'Engraved'
                  : isLocked
                    ? 'Locked'
                    : isDue
                      ? 'Ready to Review'
                      : 'Engraved Progress'}
              </Text>
              {isFullyEngraved ? (
                <EngravedIcon size={16} color={goldColor} />
              ) : isLocked ? (
                <IconSymbol name="lock.fill" size={14} color={colors.icon} />
              ) : isDue ? (
                <IconSymbol name="sparkles" size={16} color={goldColor} />
              ) : (
                <MaterialCommunityIcons name="cross" size={16} color={colors.icon} />
              )}
            </View>

            {/* Progress count + bar */}
            <View style={[styles.progressBarRow, isLocked && styles.lockedDimmed]}>
              <Text
                style={[
                  styles.progressCountText,
                  {
                    color: isLocked
                      ? colors.icon
                      : isFullyEngraved || isDue
                        ? goldColor
                        : colors.text,
                  },
                ]}
              >
                {Math.min(passCount, ENGRAVED_THRESHOLD)} / {ENGRAVED_THRESHOLD}
              </Text>
              <View style={[styles.progressBarTrack, { backgroundColor: unfilledColor }]}>
                {isDue && !isFullyEngraved ? (
                  <PulsingFill widthPct={progressPct} color={goldColor} />
                ) : (
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        backgroundColor: isLocked ? colors.icon : goldColor,
                        width: `${progressPct}%`,
                      },
                    ]}
                  />
                )}
              </View>
            </View>

            {/* Status line under bar */}
            {isLocked && fakeStatus.kind === 'locked' && (
              <View style={styles.lockedStatusRow}>
                <IconSymbol name="lock.fill" size={11} color={colors.icon} />
                <Text style={[styles.lockedStatusText, { color: colors.icon }]}>
                  {fakeStatus.hoursUntilDue > 0
                    ? `Unlocks in ${fakeStatus.hoursUntilDue}h`
                    : fakeStatus.daysUntilDue === 1
                      ? 'Unlocks tomorrow'
                      : `Unlocks in ${fakeStatus.daysUntilDue} days`}
                </Text>
              </View>
            )}
            {isDue && (
              <View style={styles.dueCallout}>
                <View style={[styles.dueCalloutPill, { backgroundColor: goldColor }]}>
                  <IconSymbol name="play.fill" size={10} color="#fff" />
                  <Text style={styles.dueCalloutText}>Review now to advance</Text>
                </View>
              </View>
            )}
            {fakeStatus.kind === 'engraved' && lifetimeReviews > 0 && (
              <Text style={[styles.lifetimeText, { color: goldColor }]}>
                {lifetimeReviews} lifetime {lifetimeReviews === 1 ? 'review' : 'reviews'}
              </Text>
            )}

            {/* Tagline when fully engraved */}
            {isFullyEngraved && (
              <Text style={[styles.tagline, { color: goldColor }]}>
                "I have hidden your word in my heart"
              </Text>
            )}
          </View>
      </View>
    </View>
  );
}

function PulsingFill({ widthPct, color }: { widthPct: number; color: string }) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.55, { duration: 900 }), -1, true);
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        styles.progressBarFill,
        animatedStyle,
        { backgroundColor: color, width: `${widthPct}%` },
      ]}
    />
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
  progressBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
  },
  progressCountText: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 56,
  },
  progressBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  lifetimeText: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 12,
  },
  statusLine: {
    textAlign: 'center',
    fontSize: 13,
    marginTop: 12,
  },
  lockedSection: {
    opacity: 0.85,
  },
  lockedDimmed: {
    opacity: 0.6,
  },
  dueSection: {
    backgroundColor: 'rgba(176, 141, 87, 0.06)',
  },
  lockedStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 12,
  },
  lockedStatusText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  dueCallout: {
    alignItems: 'center',
    marginTop: 14,
  },
  dueCalloutPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dueCalloutText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
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
