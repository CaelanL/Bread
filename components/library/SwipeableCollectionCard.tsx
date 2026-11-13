import * as Haptics from 'expo-haptics';
import { confirmRemoveCollection } from '@/components/shared/member-actions';
import { DueCountPill } from '@/components/library/DueCountPill';
import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { SWIPE_DELETE_DISTANCE, SwipeDeleteAction } from '@/components/library/SwipeDeleteAction';
import { firstName } from '@/lib/shared/display-name';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors, Motion, Radius, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { resolveCollectionIcon } from '@/lib/collections/icons';
import { collectionRemoval, type Emblem } from '@/lib/shared/progress';
import type { Collection, SharedRole } from '@/lib/storage';
import type { SymbolViewProps } from 'expo-symbols';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

export const COLLECTION_ROW_GAP = 0;
/** The Library list's side padding, where an engraved row's glow fades out. */
const GLOW_ALPHA = 0.3;
// An engraved row's gold eases out over GLOW_IN inside the row and GLOW_OUT past it, along one
// smoothstep curve, so the end of the hairline never shows as a hard band edge.
const GLOW_IN = 30;
const GLOW_OUT = 10;
// The right reads a touch short against the trailing hairline, so it carries a little further.
const GLOW_OUT_RIGHT = 14;
const OUTER_STEPS = [0, 0.043, 0.156];
const INNER_STEPS = [0.156, 0.5, 0.844, 1];

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
  onRename: () => void;
  onReorder: () => void;
  reorder?: CollectionReorder;
  actionsDisabled: boolean;
  dueCount?: number;
  /** Set for a shared collection: a member's delete is Leave, the owner's deletes for everyone. */
  sharedRole?: SharedRole;
  /** Shown for a personal collection; opens sharing. */
  onShare?: () => void;
  /** Every verse mastered or engraved; on a shared collection with others in it, by every member. */
  emblem?: Emblem | null;
  /** Set once someone besides the owner is in the shared collection, from `get_shared_status`. */
  memberCount?: number;
  /** The shared collection's owner, shown before the member count; null until known. */
  ownerName?: string | null;
}

export function SwipeableCollectionCard({
  collection,
  index,
  onPress,
  onRename,
  onReorder,
  reorder,
  actionsDisabled,
  dueCount = 0,
  sharedRole,
  onShare,
  emblem,
  memberCount,
  ownerName,
}: SwipeableCollectionCardProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { height: windowHeight } = useWindowDimensions();
  const [menuTop, setMenuTop] = useState<number | null>(null);
  // Closed when the Library loses focus, so a modal route can't present over it.
  useFocusEffect(useCallback(() => () => setMenuTop(null), []));

  const translateX = useSharedValue(0);
  const swipeStart = useSharedValue(0);
  const rowHeight = useSharedValue(0);
  const debouncedPress = useDebouncedPress(onPress);
  const isCustom = !collection.isDefault && !collection.isVirtual;
  const editing = Boolean(reorder);
  // Null while a shared collection's role loads: no Delete or Leave until it's known.
  const removal = collectionRemoval(collection.sharedId, sharedRole);
  const isLeave = removal === 'leave';
  const canSwipe = isCustom && !editing && !actionsDisabled && removal !== null;
  const verseCount = `${collection.verseCount} verse${collection.verseCount !== 1 ? 's' : ''}`;
  const engraved = emblem === 'engraved';
  const glow = withAlpha(colors.engravedBarStart, GLOW_ALPHA);
  const glowAt = (steps: number[]) => steps.map((t) => withAlpha(colors.engravedBarStart, GLOW_ALPHA * t)) as [string, string, ...string[]];
  const subtitle = memberCount !== undefined
    ? [ownerName && firstName(ownerName), `${memberCount} member${memberCount !== 1 ? 's' : ''}`].filter(Boolean).join(' · ')
    : verseCount;
  // Read into the card's label after the subtitle, so it's spoken though not written.
  const emblemLabel = `${engraved ? 'Engraved' : 'Mastered'}${memberCount !== undefined ? ' by everyone' : ''}`;

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

  const handleDelete = () => confirmRemoveCollection(collection.id, { onKept: closeSwipe });

  const openActions = (pageY: number) => {
    if (!isCustom || actionsDisabled) return;
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    closeSwipe();
    setMenuTop(pageY + 8);
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
      {/* Engraved: gold across the whole row, fading out only in the page margin past the hairline. */}
      {engraved && (
        <>
          <LinearGradient pointerEvents="none" colors={glowAt(OUTER_STEPS)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.glowOut, styles.outLeft]} />
          <LinearGradient pointerEvents="none" colors={glowAt(OUTER_STEPS)} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={[styles.glowOut, styles.outRight]} />
        </>
      )}
      <View style={styles.clip}>
      {canSwipe && <SwipeDeleteAction offset={translateX} onPress={handleDelete} label={isLeave ? 'Leave' : 'Delete'} />}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, { backgroundColor: colors.background, borderTopColor: colors.separator }, index > 0 && styles.divided, cardStyle]}>
          {engraved && (
            <>
              <LinearGradient pointerEvents="none" colors={glowAt(INNER_STEPS)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.glowIn, styles.inLeft]} />
              <View pointerEvents="none" style={[styles.glowMiddle, { backgroundColor: glow }]} />
              <LinearGradient pointerEvents="none" colors={glowAt(INNER_STEPS)} start={{ x: 1, y: 0 }} end={{ x: 0, y: 0 }} style={[styles.glowIn, styles.inRight]} />
            </>
          )}
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
              {/* Engraved fills the square like the engraved pill on a verse; the icon stays the collection's own. */}
              <View style={[
                styles.iconContainer,
                {
                  backgroundColor: engraved
                    ? colors.engravedFill
                    : collection.iconColor
                      ? `${collection.iconColor}20`
                      : collection.isDefault
                        ? colors.primaryLight
                        : isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                },
              ]}>
                <IconSymbol
                  name={(collection.icon as SymbolViewProps['name']) || (collection.isDefault ? 'heart.fill' : resolveCollectionIcon(collection.iconKey).symbol)}
                  size={24}
                  color={engraved ? colors.tint : collection.iconColor || (collection.isDefault ? colors.primary : colors.icon)}
                />
                {emblem && (
                  <View
                    accessibilityLabel={emblemLabel}
                    style={[
                      styles.badge,
                      { backgroundColor: engraved ? colors.tint : colors.success, borderColor: colors.background },
                    ]}
                  >
                    {engraved
                      ? <EngravedIcon size={11} color={colors.background} />
                      : <IconSymbol name="checkmark" size={11} color={colors.background} weight="bold" />}
                  </View>
                )}
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.collectionName, { color: colors.text }]} numberOfLines={1}>
                  {collection.name}
                </Text>
                <Text style={[styles.verseCount, { color: colors.icon }]} numberOfLines={1}>{subtitle}</Text>
              </View>
            </View>
            {!editing && (
              <View style={styles.cardRight}>
                <DueCountPill count={dueCount} />
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
      </View>

      {isCustom && (
        <PopoverMenu
          visible={menuTop !== null}
          onClose={() => setMenuTop(null)}
          anchorPosition={menuTop === null ? undefined : { top: menuTop, right: 16 }}
          items={[
            // A member's copy takes its name from the group, so only the owner renames it.
            ...(removal === 'delete' ? [{ label: 'Rename', icon: 'pencil', onPress: onRename }] : []),
            // The owner's Share… opens the code again (or Stop sharing) on a collection already shared.
            ...(onShare && removal === 'delete' ? [{ label: 'Share…', icon: 'person.2.fill', onPress: onShare }] : []),
            { label: 'Reorder', icon: 'line.3.horizontal', onPress: onReorder },
            ...(removal ? [isLeave
              ? { label: 'Leave', icon: 'rectangle.portrait.and.arrow.right', onPress: handleDelete, destructive: true }
              : { label: 'Delete', icon: 'trash', onPress: handleDelete, destructive: true }] : []),
          ]}
        />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  // Clips the row as it swipes over its delete action; the edge glow sits outside it.
  clip: {
    overflow: 'hidden',
  },
  glowOut: { position: 'absolute', top: 0, bottom: 0, width: GLOW_OUT },
  outLeft: { left: -GLOW_OUT },
  outRight: { right: -GLOW_OUT_RIGHT, width: GLOW_OUT_RIGHT },
  glowIn: { position: 'absolute', top: 0, bottom: 0, width: GLOW_IN },
  inLeft: { left: 0 },
  inRight: { right: 0 },
  glowMiddle: { position: 'absolute', top: 0, bottom: 0, left: GLOW_IN, right: GLOW_IN },
  // A flat row on the page, like a verse row in a collection: a hairline between rows, no card.
  card: {
    flexDirection: 'row',
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cardButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
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
    flexShrink: 1,
    fontSize: 14,
  },
  // Corner badge on the icon, the way iOS marks a finished item: green check for mastered, gold for engraved.
  badge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dragHandle: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
