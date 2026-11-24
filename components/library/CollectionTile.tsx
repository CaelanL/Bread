import * as Haptics from 'expo-haptics';
import { confirmRemoveCollection } from '@/components/shared/member-actions';
import { DueCountPill } from '@/components/library/DueCountPill';
import { collectionLabels, collectionMenuItems, collectionSquare } from '@/components/library/SwipeableCollectionCard';
import { EngravedIcon } from '@/components/ui/EngravedIcon';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { Colors, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { collectionRemoval, type Emblem } from '@/lib/shared/progress';
import type { Collection, SharedRole } from '@/lib/storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

/**
 * A collection as a big icon square on the iPhone Duo's grid Library (Library-Toggle board): the
 * name with its due pill, the subtitle, and the mastered or engraved badge in the square's corner.
 * Long press opens the same menu as a list row; reordering happens in the list.
 */
export function CollectionTile({
  collection,
  size,
  index,
  animateIn,
  dueCount,
  emblem,
  memberCount,
  ownerName,
  sharedRole,
  actionsDisabled,
  onPress,
  onRename,
  onReorder,
  onShare,
}: {
  collection: Collection & { verseCount: number };
  /** The square's side; the tile is as wide. */
  size: number;
  index: number;
  animateIn: boolean;
  dueCount: number;
  emblem?: Emblem | null;
  memberCount?: number;
  ownerName?: string | null;
  sharedRole?: SharedRole;
  actionsDisabled: boolean;
  onPress: () => void;
  onRename: () => void;
  onReorder: () => void;
  onShare: () => void;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; right: number } | null>(null);
  useFocusEffect(useCallback(() => () => setMenuAnchor(null), []));
  const debouncedPress = useDebouncedPress(onPress);
  const isCustom = !collection.isDefault && !collection.isVirtual;
  const removal = collectionRemoval(collection.sharedId, sharedRole);
  const engraved = emblem === 'engraved';
  const square = collectionSquare(collection, engraved, colors, colorScheme === 'dark');
  const { subtitle, emblemLabel } = collectionLabels(collection.verseCount, engraved, memberCount, ownerName);

  const tileRef = useRef<ViewInstance>(null);
  // The menu opens under the press, its right edge on the tile's.
  const openActions = (pageY: number) => {
    if (!isCustom || actionsDisabled) return;
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    tileRef.current?.measureInWindow((x, _y, width) => {
      setMenuAnchor({ top: pageY + 8, right: Math.max(16, windowWidth - (x + width)) });
    });
  };

  return (
    <Animated.View
      ref={tileRef}
      entering={animateIn ? FadeInDown.delay(Math.min(index * Motion.staggerMs, Motion.staggerCapMs)).duration(Motion.expandMs) : undefined}
      style={{ width: size }}
    >
      <Pressable
        onPress={debouncedPress}
        onLongPress={isCustom ? (event) => openActions(event.nativeEvent.pageY) : undefined}
        accessibilityRole="button"
        accessibilityLabel={`${collection.name}, ${subtitle}${emblem ? `, ${emblemLabel}` : ''}${dueCount > 0 ? `, ${dueCount} due` : ''}`}
        accessibilityActions={isCustom ? [{ name: 'collectionActions', label: 'Collection actions' }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'collectionActions') openActions(windowHeight / 2);
        }}
        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      >
        <View style={[styles.square, { width: size, height: size, backgroundColor: square.fill }]}>
          <View style={[styles.orbit, styles.outerOrbit, orbit(size * 1.4), { borderColor: square.ink }]} />
          <View style={[styles.orbit, styles.innerOrbit, orbit(size * 0.78), { borderColor: square.ink }]} />
          <IconSymbol name={square.symbol} size={64} color={square.ink} />
          {emblem && (
            <View style={[styles.badge, { backgroundColor: engraved ? colors.tint : colors.success, borderColor: colors.background }]}>
              {engraved
                ? <EngravedIcon size={15} color={colors.background} />
                : <IconSymbol name="checkmark" size={15} color={colors.background} weight="bold" />}
            </View>
          )}
        </View>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{collection.name}</Text>
          <DueCountPill count={dueCount} />
        </View>
        <Text style={[styles.subtitle, { color: colors.icon }]} numberOfLines={1}>{subtitle}</Text>
      </Pressable>

      {isCustom && (
        <PopoverMenu
          visible={menuAnchor !== null}
          onClose={() => setMenuAnchor(null)}
          anchorPosition={menuAnchor ?? undefined}
          items={collectionMenuItems(removal, {
            onRename,
            onShare,
            onReorder,
            onDelete: () => confirmRemoveCollection(collection.id),
          })}
        />
      )}
    </Animated.View>
  );
}

const orbit = (side: number) => ({ width: side, height: side, borderRadius: side / 2 });

const styles = StyleSheet.create({
  tile: { gap: 2 },
  pressed: { opacity: 0.7 },
  square: {
    borderRadius: Radius.xxl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  orbit: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth },
  outerOrbit: { opacity: 0.22 },
  innerOrbit: { opacity: 0.34 },
  // The board's corner mark: bigger than a list row's, inside the square.
  badge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '600' },
  subtitle: { fontSize: 14 },
});
