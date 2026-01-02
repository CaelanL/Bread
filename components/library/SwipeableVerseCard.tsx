import { useEffect, useState } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { formatVerseReference, type SavedVerse, type Difficulty } from '@/lib/storage';
import { getVerseText } from '@/lib/api/bible';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

const DELETE_BUTTON_WIDTH = 80;
const SWIPE_THRESHOLD = DELETE_BUTTON_WIDTH / 2;

interface SwipeableVerseCardProps {
  verse: SavedVerse;
  index: number;
  onPress: () => void;
  onDelete: () => void;
  disableSwipe?: boolean;
}

export function SwipeableVerseCard({
  verse,
  index,
  onPress,
  onDelete,
  disableSwipe = false,
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
        .then(setText)
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
  const itemHeight = useSharedValue<number | null>(null);
  const debouncedPress = useDebouncedPress(onPress);

  const panGesture = Gesture.Pan()
    .enabled(!disableSwipe)
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .onUpdate((e) => {
      // Only allow left swipe (negative values)
      translateX.value = Math.min(0, Math.max(e.translationX, -DELETE_BUTTON_WIDTH));
    })
    .onEnd(() => {
      if (translateX.value < -SWIPE_THRESHOLD) {
        // Snap to reveal delete button
        translateX.value = withSpring(-DELETE_BUTTON_WIDTH, { damping: 20 });
      } else {
        // Snap back to closed
        translateX.value = withSpring(0, { damping: 20 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const deleteButtonStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(translateX.value) / SWIPE_THRESHOLD),
  }));

  const handleDelete = () => {
    // Check if verse is mastered
    const isMastered = verse.progress?.hard?.completed === true;

    const title = isMastered ? 'Remove from collection?' : 'Delete verse?';
    const message = isMastered
      ? 'This verse will stay in your Mastered list.'
      : "You'll lose all progress on this verse.";
    const buttonText = isMastered ? 'Remove' : 'Delete';

    Alert.alert(title, message, [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => {
          // Close swipe
          translateX.value = withSpring(0, { damping: 20 });
        },
      },
      {
        text: buttonText,
        style: 'destructive',
        onPress: () => {
          // Animate card out to the left
          translateX.value = withTiming(-500, { duration: 200 }, () => {
            runOnJS(onDelete)();
          });
        },
      },
    ]);
  };

  const handlePress = () => {
    // Close swipe if open, otherwise navigate
    if (translateX.value < -10) {
      translateX.value = withSpring(0, { damping: 20 });
    } else {
      debouncedPress();
    }
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 60).duration(300)}
      style={styles.container}
    >
      {/* Delete button (behind card) */}
      <Animated.View style={[styles.deleteButtonContainer, deleteButtonStyle]}>
        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <IconSymbol name="trash.fill" size={20} color={colors.white} />
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      </Animated.View>

      {/* Swipeable card */}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={cardStyle}>
          <Pressable
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor,
              },
            ]}
            onPress={handlePress}
          >
            <View style={styles.cardContent}>
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: colors.primaryLight },
                ]}
              >
                <IconSymbol name="book.fill" size={20} color={colors.icon} />
              </View>
              <View style={styles.cardText}>
                <View style={styles.referenceRow}>
                  <Text style={[styles.verseReference, { color: primaryColor }]}>
                    {formatVerseReference(verse)}
                    <Text style={[styles.versionBadge, { color: colors.icon }]}>
                      {' '}• {verse.version}
                    </Text>
                  </Text>
                  {highestDifficulty === 'easy' && (
                    <View style={[styles.difficultyDot, { backgroundColor: '#eab308' }]} />
                  )}
                  {highestDifficulty === 'medium' && (
                    <View style={[styles.difficultyDot, { backgroundColor: '#1d4ed8' }]} />
                  )}
                  {highestDifficulty === 'hard' && (
                    <IconSymbol name="checkmark" size={12} color={colors.success} />
                  )}
                </View>
                {loading ? (
                  <ActivityIndicator size="small" color={colors.icon} style={styles.loader} />
                ) : (
                  <Text style={[styles.versePreview, { color: colors.text }]} numberOfLines={2}>
                    {text}
                  </Text>
                )}
              </View>
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
  deleteButtonContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_BUTTON_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ef4444', // Keep error red hardcoded for delete action
    borderRadius: 16,
  },
  deleteButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    gap: 4,
  },
  deleteText: {
    color: '#fff', // Always white on colored button
    fontSize: 12,
    fontWeight: '600',
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
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
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
  loader: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
});
