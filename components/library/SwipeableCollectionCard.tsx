import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { type Collection } from '@/lib/storage';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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

interface CollectionWithCount extends Collection {
  verseCount: number;
}

interface SwipeableCollectionCardProps {
  collection: CollectionWithCount;
  index: number;
  onPress: () => void;
  onDelete: () => Promise<void>;
}

export function SwipeableCollectionCard({
  collection,
  index,
  onPress,
  onDelete,
}: SwipeableCollectionCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const cardBg = colors.card;
  const borderColor = isDark ? 'rgba(201,169,98,0.3)' : 'rgba(176,141,87,0.25)'; // Bronze gold accent border
  const primaryColor = colors.primary;

  const translateX = useSharedValue(0);
  const debouncedPress = useDebouncedPress(onPress);

  // Don't allow swipe on default or virtual collections
  const canDelete = !collection.isDefault && !collection.isVirtual;

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .enabled(canDelete)
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
    const hasVerses = collection.verseCount > 0;

    const title = `Delete "${collection.name}"?`;
    const message = hasVerses
      ? 'Verses not mastered or in another collection will be deleted and lose progress.'
      : 'This collection will be permanently deleted.';

    Alert.alert(title, message, [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => {
          translateX.value = withSpring(0, { damping: 20 });
        },
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await onDelete();
            translateX.value = withTiming(-500, { duration: 200 });
          } catch {
            translateX.value = withSpring(0, { damping: 20 });
          }
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
      entering={FadeInDown.delay(index * 80).duration(300)}
      style={styles.container}
    >
      {/* Delete button (behind card) - only show if can delete */}
      {canDelete && (
        <Animated.View style={[styles.deleteButtonContainer, deleteButtonStyle]}>
          <Pressable style={styles.deleteButton} onPress={handleDelete}>
            <IconSymbol name="trash.fill" size={20} color={colors.white} />
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </Animated.View>
      )}

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
              <View style={styles.cardLeft}>
                <View
                  style={[
                    styles.iconContainer,
                    {
                      backgroundColor: collection.iconColor
                        ? `${collection.iconColor}20`
                        : collection.isDefault
                        ? `${primaryColor}15`
                        : isDark
                        ? 'rgba(255,255,255,0.1)'
                        : 'rgba(0,0,0,0.05)',
                    },
                  ]}
                >
                  <IconSymbol
                    name={collection.icon || (collection.isDefault ? 'heart.fill' : 'folder.fill')}
                    size={24}
                    color={collection.iconColor || (collection.isDefault ? primaryColor : colors.icon)}
                  />
                </View>
                <View style={styles.cardText}>
                  <Text style={[styles.collectionName, { color: colors.text }]}>
                    {collection.name}
                  </Text>
                  <Text style={[styles.verseCount, { color: colors.icon }]}>
                    {collection.verseCount} verse{collection.verseCount !== 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
              <IconSymbol name="chevron.right" size={18} color={colors.icon} />
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
    backgroundColor: '#ef4444',
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
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardText: {
    gap: 2,
  },
  collectionName: {
    fontSize: 17,
    fontWeight: '600',
  },
  verseCount: {
    fontSize: 14,
  },
});
