import { AddCollectionModal } from '@/components/library/AddCollectionModal';
import { COLLECTION_ROW_GAP, type CollectionReorder, SwipeableCollectionCard } from '@/components/library/SwipeableCollectionCard';
import { CollectionCardSkeleton } from '@/components/library/CollectionCardSkeleton';
import { CollectionTile } from '@/components/library/CollectionTile';
import { GlassButton } from '@/components/ui/Glass';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { RailContext, railFrame } from '@/components/ui/TabRail';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { LargeTitle, TopBar, TopBarButton, useMenuAnchor, useTopBarHeight } from '@/components/ui/TopBar';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowClass } from '@/hooks/use-window-class';
import { libraryView } from '@/lib/layout';
import { type Collection, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { MAX_SHARED_COLLECTIONS, shareHitsCap } from '@/lib/shared/constants';
import { hasOtherMembers, sharedEmblem, soloEmblem } from '@/lib/shared/progress';
import { perfMark } from '@/lib/api/dev-timing';
import { useAppStore, useCollections, useHydrated, useDueCounts, useInProgressVerseCount, useMasteredVerseCount, useSharedCollection, useSharedOwnerName, useVersesByCollection } from '@/lib/store';
import { ReviewNowProvider, useReviewNow, useReviewNowValue } from '@/hooks/use-review-now';
import { showErrorToast } from '@/lib/toast';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// The Duo's Library (Library-Toggle, Library-Outer boards): title 26 pt under the safe top beside the rail.
const RAIL_TOP = 26;
const GRID_COLUMNS = { wide: 4, outer: 2 } as const;
const GRID_COLUMN_GAP = 18;
const RAILED_PAD = { wide: { left: 28, right: 24 }, outer: { left: 20, right: 10 } } as const;

// Component to get verse count for a collection
function CollectionCard({
  collection,
  index,
  animateIn,
  onPress,
  onRename,
  onReorder,
  onShare,
  reorder,
  actionsDisabled,
  tileSize,
}: {
  collection: Collection;
  index: number;
  animateIn: boolean;
  onPress: () => void;
  onRename: () => void;
  onReorder: () => void;
  onShare: () => void;
  reorder?: CollectionReorder;
  actionsDisabled: boolean;
  /** Set on the Duo's grid: draw a big square tile this wide instead of a list row. */
  tileSize?: number;
}) {
  const isMastered = collection.id === MASTERED_COLLECTION_ID;
  const isInProgress = collection.id === IN_PROGRESS_COLLECTION_ID;
  const collectionVerses = useVersesByCollection(collection.id);
  const masteredVerseCount = useMasteredVerseCount();
  const inProgressVerseCount = useInProgressVerseCount();
  const now = useReviewNowValue();
  const dueCounts = useDueCounts(now);
  const shared = useSharedCollection(collection.id);
  const ownerName = useSharedOwnerName(collection.id);

  const verseCount = isMastered
    ? masteredVerseCount
    : isInProgress
      ? inProgressVerseCount
      : collectionVerses.length;
  const dueCount = isMastered ? dueCounts.mastered : 0;
  // Shared only once someone else joined; until then it's a personal card (docs/features/shared-collections.md).
  const group = shared && hasOtherMembers(shared) ? shared : undefined;
  const emblem = useMemo(() => {
    if (collection.isVirtual) return null;
    if (group) return sharedEmblem(group);
    return soloEmblem(collectionVerses.map((v) => v.progress));
  }, [collection.isVirtual, group, collectionVerses]);

  if (tileSize) {
    return (
      <CollectionTile
        collection={{ ...collection, verseCount }}
        size={tileSize}
        index={index}
        animateIn={animateIn}
        onPress={onPress}
        onRename={onRename}
        onReorder={onReorder}
        onShare={onShare}
        actionsDisabled={actionsDisabled}
        dueCount={dueCount}
        sharedRole={shared?.role}
        emblem={emblem}
        memberCount={group?.memberCount}
        ownerName={group ? ownerName : undefined}
      />
    );
  }

  return (
    <SwipeableCollectionCard
      collection={{ ...collection, verseCount }}
      index={index}
      animateIn={animateIn}
      onPress={onPress}
      onRename={onRename}
      onReorder={onReorder}
      reorder={reorder}
      actionsDisabled={actionsDisabled}
      dueCount={dueCount}
      sharedRole={shared?.role}
      onShare={onShare}
      emblem={emblem}
      memberCount={group?.memberCount}
      ownerName={group ? ownerName : undefined}
    />
  );
}

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const now = useReviewNow();

  // Store data
  const allCollections = useCollections();
  const inProgressCount = useInProgressVerseCount();
  const collections = inProgressCount > 0
    ? allCollections
    : allCollections.filter((c) => c.id !== IN_PROGRESS_COLLECTION_ID);
  const hydrated = useHydrated();
  useEffect(() => {
    if (hydrated && collections.length > 0) perfMark('library');
  }, [hydrated, collections.length]);
  const addCollection = useAppStore((s) => s.addCollection);
  const renameCollection = useAppStore((s) => s.renameCollection);
  const reorderCollections = useAppStore((s) => s.reorderCollections);
  const orderSaving = useAppStore((s) => s.collectionOrderSaving);
  const refresh = useAppStore((s) => s.refresh);

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ collection?: Collection } | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const barHeight = useTopBarHeight();
  const insets = useSafeAreaInsets();
  const menuAnchor = useMenuAnchor();
  const railed = useContext(RailContext);
  const windowClass = useWindowClass();
  const chosenView = useAppStore((s) => s.libraryView);
  // Reordering always happens in the list.
  const view = editing ? 'list' : libraryView(chosenView, windowClass);
  const columns = windowClass === 'wide' || windowClass === 'outer' ? GRID_COLUMNS[windowClass] : 0;
  // Sized from the window so the first frame draws tiles; the grid's own layout corrects it.
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const pad = RAILED_PAD[windowClass === 'outer' ? 'outer' : 'wide'];
  const gridWidth = measuredWidth || (columns ? windowWidth - railFrame(windowClass === 'outer', insets).width - pad.left - pad.right : 0);
  const tileSize = view === 'grid' && gridWidth > 0 ? Math.floor((gridWidth - GRID_COLUMN_GAP * (columns - 1)) / columns) : undefined;
  const sharedCount = useAppStore((s) => Object.keys(s.sharedCollections).length);
  const renamingCollection = nameDialog?.collection;
  // A link can present a modal route over the Library; its RN Modals must not stay up under it.
  // Two quick taps on different cards would push two collections; the first push locks until the
  // Library is focused again.
  const opening = useRef(false);
  // The cards of the list's first paint, and whether they fade in: not when the saved library
  // painted them (it should look already there). A card added later appears at once.
  const firstCards = useRef<{ ids: Set<string>; animate: boolean } | null>(null);
  if (hydrated && !firstCards.current) {
    firstCards.current = { ids: new Set(collections.map((c) => c.id)), animate: useAppStore.getState().hydratedFrom !== 'snapshot' };
  }
  useFocusEffect(useCallback(() => {
    opening.current = false;
    return () => {
      setAddMenuOpen(false);
      setNameDialog(null);
    };
  }, []));
  const customCollections = allCollections.filter((c) => !c.isDefault && !c.isVirtual);
  const actionsDisabled = refreshing || orderSaving;
  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const offset = useSharedValue(0);

  useLayoutEffect(() => {
    from.value = -1;
    to.value = -1;
    offset.value = 0;
  }, [allCollections, editing, from, to, offset]);

  const onRefresh = async () => {
    if (orderSaving) return;
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const moveCollection = (source: number, destination: number) => {
    const ids = customCollections.map((c) => c.id);
    const [moved] = ids.splice(source, 1);
    if (!moved) return;
    ids.splice(destination, 0, moved);
    void reorderCollections(ids).catch(() => {
      showErrorToast('Could not save the collection order. Please try again.');
    });
  };

  const handleAddCollection = async (name: string) => {
    try {
      await addCollection(name);
    } catch (e) {
      showErrorToast('Failed to create collection.');
      throw e; // Re-throw so caller knows it failed
    }
  };

  // The share modal is a route, never an RN Modal held here: see ModalCard. `new` names one first.
  const handleShare = (collectionId: string) => {
    if (shareHitsCap(allCollections.find((c) => c.id === collectionId)?.sharedId, sharedCount)) {
      showErrorToast(`${MAX_SHARED_COLLECTIONS} shared collections is the limit.`);
      return;
    }
    router.push(`/share/${collectionId}`);
  };

  const handleCollectionPress = (collection: Collection) => {
    if (editing || opening.current) return;
    opening.current = true;
    router.push(`/(tabs)/(library)/${collection.id}`);
  };


  const addButton = <TopBarButton testID="library-add" icon="plus" label="Add" onPress={() => setAddMenuOpen(true)} disabled={actionsDisabled} />;

  const renderEmptyHint = () => (
    <Animated.View
      entering={FadeInDown.delay(400).duration(300)}
      style={styles.hintContainer}
    >
      <Text style={[styles.hintText, { color: colors.icon }]}>
        Create collections to organize your verses by theme, book, or study plan.
      </Text>
    </Animated.View>
  );

  return (
    <ReviewNowProvider value={now}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <GestureDetector gesture={scrollGesture}>
        <Animated.ScrollView
          style={styles.scrollView}
          contentContainerStyle={[
            styles.collectionsContainer,
            railed ? (windowClass === 'outer' ? styles.outerContent : styles.wideContent) : { paddingTop: barHeight },
            railed && { paddingTop: insets.top + RAIL_TOP },
          ]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={railed ? insets.top : barHeight} />
          }
        >
          <View style={[styles.titleGap, railed && styles.titleRow, railed && view === 'grid' && styles.gridTitle]}>
            <LargeTitle root title="Library" />
            {railed && !editing && (
              <Pressable
                testID="library-view-toggle"
                accessibilityRole="button"
                accessibilityLabel={view === 'grid' ? 'Show as list' : 'Show as grid'}
                onPress={() => void useAppStore.getState().setLibraryView(view === 'grid' ? 'list' : 'grid')}
                style={({ pressed }) => [styles.viewToggle, { backgroundColor: colors.controlFill }, pressed && styles.pressed]}
              >
                <IconSymbol name={view === 'grid' ? 'list.bullet' : 'square.grid.2x2'} size={20} color={colors.text} />
              </Pressable>
            )}
          </View>
          {!hydrated ? (
            <CollectionCardSkeleton count={3} />
          ) : (
            <View
              style={view === 'grid' && styles.grid}
              onLayout={columns ? (event) => setMeasuredWidth(event.nativeEvent.layout.width) : undefined}
            >
              {collections.map((collection, index) => {
                const customIndex = customCollections.indexOf(collection);
                return (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    index={index}
                    animateIn={!!firstCards.current?.animate && firstCards.current.ids.has(collection.id)}
                    onPress={() => handleCollectionPress(collection)}
                    onRename={() => setNameDialog({ collection })}
                    onReorder={() => setEditing(true)}
                    onShare={() => handleShare(collection.id)}
                    actionsDisabled={actionsDisabled}
                    tileSize={tileSize}
                    reorder={editing && customIndex >= 0 ? {
                      index: customIndex,
                      count: customCollections.length,
                      disabled: actionsDisabled,
                      scrollGesture,
                      from,
                      to,
                      offset,
                      onMove: moveCollection,
                    } : undefined}
                  />
                );
              })}
              {collections.length <= 1 && renderEmptyHint()}
            </View>
          )}
        </Animated.ScrollView>
        </GestureDetector>
        <TopBar>
          {/* In the rail, Add comes first and Edit is a glass word (Library-Toggle board). */}
          {railed && addButton}
          {(editing || customCollections.length > 0) && (railed ? (
            <GlassButton text={editing ? 'Done' : 'Edit'} label={editing ? 'Done' : 'Edit'} onPress={() => setEditing(!editing)} disabled={actionsDisabled} />
          ) : (
            <Pressable
              style={styles.editButton}
              onPress={() => setEditing(!editing)}
              accessibilityRole="button"
              disabled={actionsDisabled}
            >
              <Text style={[styles.editLabel, { color: colors.text }]}>{editing ? 'Done' : 'Edit'}</Text>
            </Pressable>
          ))}
          {!railed && addButton}
        </TopBar>

        {nameDialog && (
          <AddCollectionModal
            visible
            initialName={renamingCollection?.name}
            onClose={() => setNameDialog(null)}
            onAdd={renamingCollection
              ? (name) => renameCollection(renamingCollection.id, name)
              : handleAddCollection}
          />
        )}
        <PopoverMenu
          visible={addMenuOpen}
          onClose={() => setAddMenuOpen(false)}
          anchorPosition={menuAnchor}
          items={[
            { label: 'New collection', icon: 'folder.fill', onPress: () => setNameDialog({}) },
            { label: 'New shared collection', icon: 'person.2.fill', onPress: () => handleShare('new') },
            { label: 'Join with code', icon: 'number', onPress: () => router.push('/join') },
          ]}
        />
      </View>
    </ReviewNowProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  titleGap: {
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  gridTitle: {
    marginBottom: 20,
  },
  viewToggle: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.5,
  },
  wideContent: {
    paddingLeft: RAILED_PAD.wide.left,
    paddingRight: RAILED_PAD.wide.right,
  },
  outerContent: {
    paddingLeft: RAILED_PAD.outer.left,
    paddingRight: RAILED_PAD.outer.right,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: GRID_COLUMN_GAP,
    rowGap: 22,
  },
  editButton: {
    padding: 10,
  },
  editLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  collectionsContainer: {
    padding: 16,
    gap: COLLECTION_ROW_GAP,
  },
  hintContainer: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  hintText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
