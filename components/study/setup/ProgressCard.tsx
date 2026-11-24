import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { Colors, Radius, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReviewNow } from '@/hooks/use-review-now';
import type { VerseProgress } from '@/lib/storage';
import { formatTimeUntilDue } from '@/lib/store/review';
import { ENGRAVED_THRESHOLD } from '@/lib/store/review-config';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ProgressInfoButton, ProgressInfoModal } from '@/components/study/ProgressInfoModal';

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

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.scoresRow}>
          {(['easy', 'medium', 'hard'] as Difficulty[]).map((difficulty, index) => {
            const score = getScore(difficulty);
            const isCompleted = progress[difficulty]?.completed === true;

            return (
              <View
                key={difficulty}
                style={[
                  styles.scoreColumn,
                  index < 2 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
                ]}
              >
                <Text style={[styles.scoreLabel, { color: colors.icon }]}>
                  {difficultyLabels[difficulty]}
                </Text>
                <Text style={[
                  styles.scoreValue,
                  { color: isCompleted ? colors.success : score !== null ? colors.warning : colors.icon },
                  score === null && styles.scoreValueMuted,
                ]}>
                  {score !== null ? `${score}%` : '—'}
                  {isCompleted && ' ✓'}
                </Text>
              </View>
            );
          })}
        </View>

        <View style={[
          styles.engravedSection,
          { borderTopColor: colors.borderLight },
          isEngraved && styles.engravedSectionGlow,
        ]}>
          <View style={styles.engravedHeader}>
            {isEngraved ? (
              <EngravedIcon size={16} color={goldColor} />
            ) : state === 'locked' ? (
              <MaterialCommunityIcons name="lock-outline" size={16} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="cross" size={16} color={colors.icon} />
            )}
            <Text style={[styles.engravedLabel, { color: isEngraved ? goldColor : colors.text }]}>
              {isEngraved ? 'Engraved' : state === 'due' ? 'Ready to Review' : 'Engraved Progress'}
            </Text>
            <View style={styles.spacer} />
            <Text style={[styles.countText, { color: isEngraved ? goldColor : colors.text }]}>
              {Math.min(passCount, ENGRAVED_THRESHOLD)} / {ENGRAVED_THRESHOLD}
            </Text>
          </View>

          <View style={[styles.barTrack, { backgroundColor: trackColor }]}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${progressFraction * 100}%`,
                  backgroundColor: isEngraved || state === 'due' ? goldColor : colors.icon,
                  opacity: state === 'locked' ? 0.5 : 1,
                },
              ]}
            />
          </View>

          {state === 'due' && !isEngraved && (
            <View style={[styles.callout, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.calloutText, { color: goldColor }]}>Review now to advance</Text>
            </View>
          )}
          {state === 'locked' && e?.nextDueAt && (() => {
            const label = formatTimeUntilDue(new Date(e.nextDueAt).getTime() - now.getTime());
            const text = label === 'tmr' ? 'Unlocks tomorrow' : `Unlocks in ${label}`;
            return <Text style={[styles.statusText, { color: colors.icon }]}>{text}</Text>;
          })()}
          {isEngraved && (
            <Text style={[styles.tagline, { color: goldColor }]}>
              &quot;I have hidden your word in my heart&quot;
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  card: {
    borderRadius: Radius.xxxl,
    boxShadow: Shadows.card,
  },
  scoresRow: {
    flexDirection: 'row',
    paddingVertical: 4,
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
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 8,
    borderBottomLeftRadius: Radius.xxxl,
    borderBottomRightRadius: Radius.xxxl,
  },
  engravedSectionGlow: {
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  engravedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  engravedLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  spacer: {
    flex: 1,
  },
  countText: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    width: '100%',
    height: 6,
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
    borderRadius: 3,
  },
  callout: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.full,
  },
  calloutText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusText: {
    fontSize: 12,
  },
  tagline: {
    fontSize: 11,
    letterSpacing: 0.3,
    fontStyle: 'italic',
  },
});
