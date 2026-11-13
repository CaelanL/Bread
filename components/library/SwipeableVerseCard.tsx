import { useAppStore } from '@/lib/store';
import * as Haptics from 'expo-haptics';
import { ReviewStateBadge } from '@/components/library/ReviewStateBadge';
import { SWIPE_DELETE_DISTANCE, SwipeDeleteAction } from '@/components/library/SwipeDeleteAction';
import { GroupCount } from '@/components/shared/MemberState';
import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Motion, Radius } from '@/constants/theme';
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
import { scheduleOnRN } from 'react-native-worklets';

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
  /** Set in a shared collection with other members: every member's state, for the count on the right (null until read). */
  group?: { states: MemberState[] | null; unavailable: boolean };
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

  // Text loading state (for verses without cached text)
  const [text, setText] = useState<string>(verse.text || '');
  const [loading, setLoading] = useState(!verse.text);
  const hideText = useAppStore((state) => state.hideVerseText);

  useEffect(() => {
    if (!verse.text && !hideText) {
      setLoading(true);
      getVerseText(verse)
        .then(({ text }) => setText(text))
        .catch(() => setText('Failed to load verse text'))
        .finally(() => setLoading(false));
    }
  }, [verse, hideText]);

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
  const [open, setOpen] = useState(false);
  const debouncedPress = useDebouncedPress(onPress);
  const closeSwipe = () => {
    translateX.value = withTiming(0, { duration: Motion.pressMs });
    setOpen(false);
  };

  const panGesture = Gesture.Pan()
    .enabled(!disableSwipe)
    .failOffsetY([-5, 5])
    .onStart(() => {
      swipeStart.value = translateX.value;
    })
    .onUpdate((e) => {
      translateX.value = Math.min(0, Math.max(swipeStart.value + e.translationX, -SWIPE_DELETE_DISTANCE));
    })
    .onEnd(() => {
      const opened = translateX.value < -SWIPE_DELETE_DISTANCE / 2;
      translateX.value = withTiming(opened ? -SWIPE_DELETE_DISTANCE : 0, { duration: Motion.pressMs });
      scheduleOnRN(setOpen, opened);
    });
  // A closed row lets a rightward drag go, so the screen's swipe back gets it first time; an open
  // row takes it, to close.
  if (open) panGesture.activeOffsetX([-10, 10]);
  else panGesture.activeOffsetX(-10).failOffsetX(10);

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

  const engraved = verse.progress.engraved?.completed === true;

  return (
    <Animated.View style={styles.container}>
      {!disableSwipe && <SwipeDeleteAction offset={translateX} onPress={handleDelete} />}

      <GestureDetector gesture={panGesture}>
        <Animated.View style={cardStyle}>
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill }]}
            unstable_pressDelay={PRESS_DELAY_MS}
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
            <View style={[styles.rowText, hideText && styles.rowTextHidden]}>
              <View style={styles.referenceRow}>
                <Text style={[styles.reference, { color: engraved ? colors.tint : colors.text }]} numberOfLines={1}>
                  {formatVerseReference(verse)}
                  <Text style={[styles.version, { color: colors.icon }]}> · {verse.version}</Text>
                </Text>
                {/* Where the verse stands: a dot for Easy (grey) or Medium (blue), a check once
                    mastered, the engraved glyph once engraved. */}
                {!verse.progress.hard.completed && highestDifficulty === 'easy' ? (
                  <View style={[styles.difficultyDot, { backgroundColor: '#a5a5a5ff' }]} />
                ) : !verse.progress.hard.completed && highestDifficulty === 'medium' ? (
                  <View style={[styles.difficultyDot, { backgroundColor: '#1d4ed8' }]} />
                ) : engraved ? (
                  <EngravedIcon size={13} color={colors.tint} />
                ) : verse.progress.hard.completed ? (
                  <IconSymbol name="checkmark" size={13} color={colors.success} />
                ) : null}
              </View>
              {hideText ? null : loading ? (
                <Skeleton width="70%" height={14} borderRadius={4} style={styles.previewSkeleton} />
              ) : (
                <Text style={[styles.preview, { color: colors.icon }]} numberOfLines={1}>
                  {text}
                </Text>
              )}
              {verse.progress.hard.completed && !engraved && (
                <View style={styles.badge}>
                  <ReviewStateBadge verse={verse} />
                </View>
              )}
            </View>
            {group && <GroupCount states={group.states} unavailable={group.unavailable} />}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// A row highlights only once a touch stays, so a scroll doesn't flash every row it starts on.
const PRESS_DELAY_MS = 80;

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  // With the text line hidden, a little more air between the reference and the pill below it.
  rowTextHidden: {
    gap: 6,
  },
  referenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reference: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
  },
  version: {
    fontSize: 13,
    fontWeight: '400',
  },
  difficultyDot: {
    width: 8,
    height: 8,
    borderRadius: Radius.xs,
  },
  preview: {
    fontSize: 15,
    lineHeight: 20,
  },
  previewSkeleton: {
    marginVertical: 3,
  },
  badge: {
    marginTop: 4,
  },
});
