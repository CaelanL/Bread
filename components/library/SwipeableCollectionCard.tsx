import { DueCountPill } from '@/components/library/DueCountPill';
import { SWIPE_DELETE_DISTANCE, SwipeDeleteAction } from '@/components/library/SwipeDeleteAction';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import type { Collection } from '@/lib/storage';
import type { SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export const COLLECTION_ROW_GAP = 12;

export interface CollectionReorder {
  index: number;
  count: number;
  disabled: boolean;
  scrollGesture: ReturnType<typeof Gesture.Native>;
  from: SharedValue<number>;
  to: SharedValue<number>;
  offset: SharedValue<number>;
  onMove: (from: number, to: number) => void;
}

interface SwipeableCollectionCardProps {
  collection: Collection & { verseCount: number };
  index: number;
  onPress: () => void;
  onDelete: () => Promise<void>;
  onRename: () => void;
  onReorder: () => void;
  reorder?: CollectionReorder;
  actionsDisabled: boolean;
  dueCount?: number;
}

export function SwipeableCollectionCard({
  collection,
  index,
  onPress,
  onDelete,
  onRename,
  onReorder,
  reorder,
  actionsDisabled,
  dueCount = 0,
}: SwipeableCollectionCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const borderColor = isDark ? 'rgba(201,169,98,0.3)' : 'rgba(176,141,87,0.25)';
  const { height: windowHeight } = useWindowDimensions();
  const [menuTop, setMenuTop] = useState<number | null>(null);

  const translateX = useSharedValue(0);
  const swipeStart = useSharedValue(0);
  const rowHeight = useSharedValue(0);
  const debouncedPress = useDebouncedPress(onPress);
  const isCustom = !collection.isDefault && !collection.isVirtual;
  const editing = Boolean(reorder);
  const canSwipe = isCustom && !editing && !actionsDisabled;

  useEffect(() => {
    if (!canSwipe) translateX.value = 0;
  }, [canSwipe, translateX]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-5, 5])
    .enabled(canSwipe)
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

  const from = reorder?.from;
  const to = reorder?.to;
  const offset = reorder?.offset;
  const reorderIndex = reorder?.index ?? -1;
  const reorderCount = reorder?.count ?? 0;
  const onMove = reorder?.onMove;
  const dragGesture = Gesture.Pan()
    .enabled(Boolean(reorder && !reorder.disabled))
    .activeOffsetY([-5, 5])
    .failOffsetX([-12, 12])
    .onStart(() => {
      if (!from || !to || !offset || from.value !== -1) return;
      from.value = reorderIndex;
      to.value = reorderIndex;
      offset.value = 0;
    })
    .onUpdate((event) => {
      if (!from || !to || !offset || from.value !== reorderIndex) return;
      const pitch = rowHeight.value + COLLECTION_ROW_GAP;
      const delta = Math.max(-reorderIndex * pitch, Math.min((reorderCount - 1 - reorderIndex) * pitch, event.translationY));
      offset.value = delta;
      to.value = reorderIndex + Math.round(delta / pitch);
    })
    .onFinalize((_event, success) => {
      if (!from || !to || !offset || from.value !== reorderIndex) return;
      const destination = to.value;
      if (success && onMove && destination !== reorderIndex) {
        offset.value = (destination - reorderIndex) * (rowHeight.value + COLLECTION_ROW_GAP);
        scheduleOnRN(onMove, reorderIndex, destination);
      } else {
        from.value = -1;
        to.value = -1;
        offset.value = 0;
      }
    });
  if (reorder) dragGesture.blocksExternalGesture(reorder.scrollGesture);

  const dragStyle = useAnimatedStyle(() => {
    const origin = from?.value ?? -1;
    const target = to?.value ?? -1;
    const dragging = origin >= 0 && origin === reorderIndex;
    const pitch = rowHeight.value + COLLECTION_ROW_GAP;
    let shift = 0;
    if (origin >= 0 && reorderIndex >= 0) {
      if (origin < reorderIndex && reorderIndex <= target) shift = -pitch;
      if (target <= reorderIndex && reorderIndex < origin) shift = pitch;
    }
    return {
      zIndex: dragging ? 1 : 0,
      transform: [{
        translateY: dragging ? (offset?.value ?? 0)
          : origin < 0 ? 0 : withTiming(shift, { duration: Motion.pressMs }),
      }],
    };
  });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const closeSwipe = () => {
    translateX.value = withTiming(0, { duration: Motion.pressMs });
  };

  const handleDelete = () => {
    const title = `Delete "${collection.name}"?`;
    const message = collection.verseCount > 0
      ? 'Verses not mastered or in another collection will be deleted and lose progress.'
      : 'This collection will be permanently deleted.';

    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: closeSwipe },
      {
        text: 'Delete',
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

  const openActions = (pageY: number) => {
    if (!isCustom || actionsDisabled) return;
    closeSwipe();
    setMenuTop(Math.min(pageY + 8, windowHeight - 180));
  };

  const handlePress = () => {
    if (translateX.value < -10) closeSwipe();
    else debouncedPress();
  };

  return (
    <Animated.View
      entering={reorder ? undefined : FadeInDown.delay(index * Motion.staggerMs).duration(Motion.expandMs)}
      onLayout={(event) => { rowHeight.value = event.nativeEvent.layout.height; }}
      style={[styles.container, reorder && dragStyle]}
    >
      {canSwipe && <SwipeDeleteAction offset={translateX} onPress={handleDelete} />}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, { backgroundColor: colors.card, borderColor }, cardStyle]}>
          <Pressable
            style={styles.cardButton}
            onPress={handlePress}
            onLongPress={isCustom ? (event) => openActions(event.nativeEvent.pageY) : undefined}
            accessibilityRole="button"
            accessibilityActions={isCustom ? [{ name: 'collectionActions', label: 'Collection actions' }] : undefined}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'collectionActions') openActions(windowHeight / 2);
            }}
          >
            <View style={styles.cardLeft}>
              <View style={[
                styles.iconContainer,
                {
                  backgroundColor: collection.iconColor
                    ? `${collection.iconColor}20`
                    : collection.isDefault
                      ? colors.primaryLight
                      : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                },
              ]}>
                <IconSymbol
                  name={(collection.icon as SymbolViewProps['name']) || (collection.isDefault ? 'heart.fill' : 'folder.fill')}
                  size={24}
                  color={collection.iconColor || (collection.isDefault ? colors.primary : colors.icon)}
                />
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.collectionName, { color: colors.text }]} numberOfLines={1}>
                  {collection.name}
                </Text>
                <Text style={[styles.verseCount, { color: colors.icon }]}>
                  {collection.verseCount} verse{collection.verseCount !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            {!editing && (
              <View style={styles.cardRight}>
                <DueCountPill count={dueCount} />
                <IconSymbol name="chevron.right" size={18} color={colors.icon} />
              </View>
            )}
          </Pressable>
          {reorder && (
            <GestureDetector gesture={dragGesture}>
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={`Reorder ${collection.name}`}
                accessibilityState={{ disabled: reorder.disabled }}
                accessibilityActions={[
                  ...(reorderIndex > 0 ? [{ name: 'decrement', label: 'Move up' }] : []),
                  ...(reorderIndex < reorderCount - 1 ? [{ name: 'increment', label: 'Move down' }] : []),
                ]}
                onAccessibilityAction={(event) => {
                  if (reorder.disabled) return;
                  const target = reorderIndex + (event.nativeEvent.actionName === 'decrement' ? -1 : 1);
                  if (target >= 0 && target < reorderCount) reorder.onMove(reorderIndex, target);
                }}
                style={styles.dragHandle}
              >
                <IconSymbol name="line.3.horizontal" size={22} color={colors.icon} />
              </View>
            </GestureDetector>
          )}
        </Animated.View>
      </GestureDetector>

      {isCustom && (
        <PopoverMenu
          visible={menuTop !== null}
          onClose={() => setMenuTop(null)}
          anchorPosition={menuTop === null ? undefined : { top: menuTop, right: 16 }}
          items={[
            { label: 'Rename', icon: 'pencil', onPress: onRename },
            { label: 'Reorder', icon: 'line.3.horizontal', onPress: onReorder },
            { label: 'Delete', icon: 'trash', onPress: handleDelete, destructive: true },
          ]}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: Radius.xxl,
  },
  card: {
    flexDirection: 'row',
    borderRadius: Radius.xxl,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cardButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  cardRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  collectionName: {
    fontSize: 17,
    fontWeight: '600',
  },
  verseCount: {
    fontSize: 14,
  },
  dragHandle: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
