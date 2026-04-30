import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReviewNow } from '@/hooks/use-review-now';
import type { VerseProgress } from '@/lib/storage';
import { formatTimeUntilDue } from '@/lib/store/review';
import { ENGRAVED_THRESHOLD } from '@/lib/store/review-config';
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

export function ProgressCard({ progress }: ProgressCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const now = useReviewNow();
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  const goldColor = colors.tint;
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  const getScore = (difficulty: Difficulty): number | null => {
    return progress[difficulty]?.bestAccuracy ?? null;
  };

  const e = progress.engraved;
  const masteredOnHard = progress.hard?.completed === true;
  const passCount = e?.passCount ?? 0;
  const isEngraved = e?.completed === true;

  // State derivation matches the badge precedence (engraved > due > locked > pre).
  let state: 'pre-mastery' | 'locked' | 'due' | 'engraved';
  if (isEngraved) {
    state = 'engraved';
  } else if (!masteredOnHard) {
    state = 'pre-mastery';
  } else if (!e || e.nextDueAt === null) {
    state = 'due';
  } else if (now.getTime() >= new Date(e.nextDueAt).getTime()) {
    state = 'due';
  } else {
    state = 'locked';
  }

  const progressFraction = Math.min(passCount / ENGRAVED_THRESHOLD, 1);

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
          { borderTopColor: isEngraved ? 'rgba(245, 158, 11, 0.3)' : colors.borderLight },
          isEngraved && styles.engravedSectionGlow,
        ]}>
          {/* Header */}
          <View style={styles.engravedHeader}>
            <Text style={[
              styles.engravedLabel,
              { color: isEngraved ? goldColor : colors.icon },
            ]}>
              {isEngraved ? 'Engraved' : state === 'due' ? 'Ready to Review' : 'Engraved Progress'}
            </Text>
            {isEngraved ? (
              <EngravedIcon size={16} color={goldColor} />
            ) : state === 'locked' ? (
              <MaterialCommunityIcons name="lock-outline" size={16} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="cross" size={16} color={colors.icon} />
            )}
          </View>

          {/* Numeric count */}
          <Text style={[styles.countText, { color: isEngraved ? goldColor : colors.text }]}>
            {Math.min(passCount, ENGRAVED_THRESHOLD)} / {ENGRAVED_THRESHOLD}
          </Text>

          {/* Progress bar */}
          <View style={[styles.barTrack, { backgroundColor: trackColor }]}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${progressFraction * 100}%`,
                  backgroundColor: isEngraved ? goldColor : state === 'due' ? goldColor : colors.icon,
                  opacity: state === 'locked' ? 0.5 : 1,
                },
              ]}
            />
          </View>

          {/* Status line */}
          {state === 'due' && !isEngraved && (
            <View style={[styles.callout, { backgroundColor: `${goldColor}20` }]}>
              <Text style={[styles.calloutText, { color: goldColor }]}>Review now to advance</Text>
            </View>
          )}
          {state === 'locked' && e?.nextDueAt && (() => {
            const label = formatTimeUntilDue(new Date(e.nextDueAt).getTime() - now.getTime());
            const text = label === 'tmr' ? 'Unlocks tomorrow' : `Unlocks in ${label}`;
            return (
              <Text style={[styles.statusText, { color: colors.icon }]}>
                {text}
              </Text>
            );
          })()}
          {isEngraved && (
            <Text style={[styles.tagline, { color: goldColor }]}>
              "I have hidden your word in my heart"
            </Text>
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
    alignItems: 'center',
    gap: 10,
  },
  engravedSectionGlow: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  engravedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  engravedLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  countText: {
    fontSize: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  callout: {
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  calloutText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusText: {
    marginTop: 2,
    fontSize: 12,
  },
  tagline: {
    textAlign: 'center',
    fontSize: 10,
    letterSpacing: 0.3,
    fontStyle: 'italic',
  },
});
