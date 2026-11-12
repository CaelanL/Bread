import * as Haptics from 'expo-haptics';
import { ReviewStateBadge } from '@/components/library/ReviewStateBadge';
import { SWIPE_DELETE_DISTANCE, SwipeDeleteAction } from '@/components/library/SwipeDeleteAction';
import { GroupCount, MemberStateDot } from '@/components/shared/MemberState';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { getVerseText } from '@/lib/api/bible';
import type { MemberState } from '@/lib/shared/progress';
import { formatVerseReference, type Difficulty, type SavedVerse } from '@/lib/storage';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface SwipeableVerseCardProps {
  verse: SavedVerse;
  onPress: () => void;
  onDelete: () => Promise<void>;
  onCopy: () => void;
  disableSwipe?: boolean;
  /** Number of collections this verse is in (for accurate delete message) */
  collectionCount?: number;
  /** Set in a shared collection: removing the verse removes it for every member. */
  sharedMemberCount?: number;
  /** Set in a shared collection: your state on the left, every member's on the right (null until read). */
  group?: { you: MemberState; states: MemberState[] | null; unavailable: boolean };
}

export function SwipeableVerseCard({
  verse,
  onPress,
  onDelete,
  onCopy,
  disableSwipe = false,
  collectionCount = 1,
  sharedMemberCount,
  group,
}: SwipeableVerseCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const cardBg = colors.card;
  const borderColor = isDark ? 'rgba(201,169,98,0.3)' : 'rgba(176,141,87,0.25)'; // Keep for subtle accent border
  const primaryColor = colors.tint;

  // Text loading state (for verses without cached text)
  const [text, setText] = useState<string>(verse.text || '');
  const [loading, setLoading] = useState(!verse.text);

  useEffect(() => {
    if (!verse.text) {
      setLoading(true);
      getVerseText(verse)
        .then(({ text }) => setText(text))
        .catch(() => setText('Failed to load verse text'))
        .finally(() => setLoading(false));
    }
  }, [verse]);

  // Get highest completed difficulty (90%+)
  const getHighestDifficulty = (): Difficulty | null => {
    if (verse.progress.hard.completed) return 'hard';
    if (verse.progress.medium.completed) return 'medium';
    if (verse.progress.easy.completed) return 'easy';
    return null;
  };
  const highestDifficulty = getHighestDifficulty();

  const translateX = useSharedValue(0);
  const swipeStart = useSharedValue(0);
  const debouncedPress = useDebouncedPress(onPress);
  const closeSwipe = () => {
    translateX.value = withTiming(0, { duration: Motion.pressMs });
  };

  const panGesture = Gesture.Pan()
    .enabled(!disableSwipe)
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onStart(() => {
      swipeStart.value = translateX.value;
    })
    .onUpdate((e) => {
      translateX.value = Math.min(0, Math.max(swipeStart.value + e.translationX, -SWIPE_DELETE_DISTANCE));
    })
    .onEnd(() => {
      translateX.value = withTiming(
        translateX.value < -SWIPE_DELETE_DISTANCE / 2 ? -SWIPE_DELETE_DISTANCE : 0,
        { duration: Motion.pressMs },
      );
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const handleDelete = () => {
    const isMastered = verse.progress?.hard?.completed === true;
    const inOtherCollections = collectionCount > 1;

    // Determine alert content based on state
    let title: string;
    let message: string;
    let buttonText: string;

    if (inOtherCollections) {
      // Verse is in multiple collections - just removing from this one
      const otherCount = collectionCount - 1;
      title = 'Remove from collection?';
      message = `This verse is in ${otherCount} other collection${otherCount > 1 ? 's' : ''}. Progress will be kept.`;
      buttonText = 'Remove';
    } else if (isMastered) {
      // Only in this collection but mastered - will be soft-deleted
      title = 'Remove from collection?';
      message = 'This verse will stay in your Mastered list.';
      buttonText = 'Remove';
    } else {
      // Only in this collection and not mastered - will be hard-deleted
      title = 'Delete verse?';
      message = "You'll lose all progress on this verse.";
      buttonText = 'Delete';
    }

    if (sharedMemberCount !== undefined) {
      title = 'Remove for everyone?';
      message = `It leaves this collection for all ${sharedMemberCount} member${sharedMemberCount === 1 ? '' : 's'}. For you: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
      buttonText = 'Remove';
    }

    Alert.alert(title, message, [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: closeSwipe,
      },
      {
        text: buttonText,
        style: 'destructive',
        onPress: async () => {
          try {
            await onDelete();
          } catch {
            closeSwipe();
          }
        },
      },
    ]);
  };

  const handlePress = () => {
    // Close swipe if open, otherwise navigate
    if (translateX.value < -10) {
      closeSwipe();
    } else {
      debouncedPress();
    }
  };

  const handleCopy = () => {
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    closeSwipe();
    onCopy();
  };

  return (
    <Animated.View
      style={styles.container}
    >
      {!disableSwipe && <SwipeDeleteAction offset={translateX} onPress={handleDelete} />}

      {/* Swipeable card */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={cardStyle}>
          <Pressable
            style={[
              styles.card,
              {
                backgroundColor: verse.progress.engraved?.completed
                  ? colors.cardAlt
                  : cardBg,
                borderColor,
              },
            ]}
            onPress={handlePress}
            onLongPress={handleCopy}
            accessibilityActions={[
              { name: 'copy', label: 'Copy to collection' },
              ...(!disableSwipe ? [{ name: 'delete', label: 'Delete' }] : []),
            ]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'copy') handleCopy();
              if (!disableSwipe && event.nativeEvent.actionName === 'delete') handleDelete();
            }}
          >
            {/* Gold glow overlay when engraved */}
            {verse.progress.engraved?.completed && (
              <View style={styles.engravedGlow} />
            )}
            <View style={styles.cardContent}>
              {group ? (
                <View style={styles.youColumn}>
                  <MemberStateDot state={group.you} />
                </View>
              ) : (
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: colors.primaryLight },
                  ]}
                >
                  <IconSymbol name="book.fill" size={20} color={colors.icon} />
                </View>
              )}
              <View style={styles.cardText}>
                <View style={styles.referenceRow}>
                  <Text style={[styles.verseReference, { color: verse.progress.engraved?.completed ? primaryColor : colors.text }]}>
                    {formatVerseReference(verse)}
                    <Text style={[styles.versionBadge, { color: verse.progress.engraved?.completed ? colors.tint : colors.icon }]}>
                      {' '}• {verse.version}
                    </Text>
                  </Text>
                  {/* Top-line indicator. Unmastered verses show a
                      progression dot (gray=easy, blue=medium).
                      Mastered-but-not-engraved verses get a green
                      checkmark — visual parity with the unmastered
                      dots so users can scan a list at a glance.
                      Engraved verses skip this slot; their gold
                      card styling (glow + reference text color) is
                      the indicator. ReviewStateBadge below carries
                      the SR review-status detail in all cases. */}
                  {group ? null : !verse.progress.hard.completed && highestDifficulty === 'easy' ? (
                    <View style={[styles.difficultyDot, { backgroundColor: '#a5a5a5ff'}]} />
                  ) : !verse.progress.hard.completed && highestDifficulty === 'medium' ? (
                    <View style={[styles.difficultyDot, { backgroundColor: '#1d4ed8' }]} />
                  ) : verse.progress.hard.completed && !verse.progress.engraved?.completed ? (
                    <IconSymbol name="checkmark" size={14} color={colors.success} />
                  ) : null}
                </View>
                {loading ? (
                  <View style={styles.skeletonContainer}>
                    <Skeleton width="100%" height={15} borderRadius={4} />
                    <Skeleton width="65%" height={15} borderRadius={4} />
                  </View>
                ) : (
                  <Text style={[styles.versePreview, { color: colors.text }]} numberOfLines={2}>
                    {text}
                  </Text>
                )}
                <ReviewStateBadge verse={verse} />
              </View>
              {group && <GroupCount states={group.states} unavailable={group.unavailable} />}
            </View>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 16,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
  engravedGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  youColumn: {
    width: 24,
    alignItems: 'center',
    paddingTop: 4,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardText: {
    flex: 1,
    gap: 4,
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verseReference: {
    fontSize: 15,
    fontWeight: '600',
  },
  difficultyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  versionBadge: {
    fontWeight: '400',
  },
  versePreview: {
    fontSize: 15,
    lineHeight: 21,
  },
  skeletonContainer: {
    gap: 6,
    height: 42, // Match 2 lines of text (lineHeight 21 * 2)
  },
});
