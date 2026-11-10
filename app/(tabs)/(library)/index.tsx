import { IconSymbol } from '@/components/ui/icon-symbol';
import { AddCollectionModal } from '@/components/library/AddCollectionModal';
import { COLLECTION_ROW_GAP, type CollectionReorder, SwipeableCollectionCard } from '@/components/library/SwipeableCollectionCard';
import { CollectionCardSkeleton } from '@/components/library/CollectionCardSkeleton';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type Collection, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { useAppStore, useCollections, useHydrated, useCollectionVerseCount, useDueCounts, useInProgressVerseCount, useMasteredVerseCount } from '@/lib/store';
import { ReviewNowProvider, useReviewNow, useReviewNowValue } from '@/hooks/use-review-now';
import { showErrorToast } from '@/lib/toast';
import { router } from 'expo-router';
import { useLayoutEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, useSharedValue } from 'react-native-reanimated';

// Component to get verse count for a collection
function CollectionCard({
  collection,
  index,
  onPress,
  onDelete,
  onRename,
  onReorder,
  reorder,
  actionsDisabled,
}: {
  collection: Collection;
  index: number;
  onPress: () => void;
  onDelete: () => Promise<void>;
  onRename: () => void;
  onReorder: () => void;
  reorder?: CollectionReorder;
  actionsDisabled: boolean;
}) {
  const isMastered = collection.id === MASTERED_COLLECTION_ID;
  const isInProgress = collection.id === IN_PROGRESS_COLLECTION_ID;
  const collectionVerseCount = useCollectionVerseCount(collection.id);
  const masteredVerseCount = useMasteredVerseCount();
  const inProgressVerseCount = useInProgressVerseCount();
  const now = useReviewNowValue();
  const dueCounts = useDueCounts(now);

  const verseCount = isMastered
    ? masteredVerseCount
    : isInProgress
      ? inProgressVerseCount
      : collectionVerseCount;
  const dueCount = isMastered ? dueCounts.mastered : 0;

  return (
    <SwipeableCollectionCard
      collection={{ ...collection, verseCount }}
      index={index}
      onPress={onPress}
      onDelete={onDelete}
      onRename={onRename}
      onReorder={onReorder}
      reorder={reorder}
      actionsDisabled={actionsDisabled}
      dueCount={dueCount}
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
  const addCollection = useAppStore((s) => s.addCollection);
  const renameCollection = useAppStore((s) => s.renameCollection);
  const reorderCollections = useAppStore((s) => s.reorderCollections);
  const orderSaving = useAppStore((s) => s.collectionOrderSaving);
  const deleteCollection = useAppStore((s) => s.deleteCollection);
  const refresh = useAppStore((s) => s.refresh);

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ collection?: Collection } | null>(null);
  const renamingCollection = nameDialog?.collection;
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

  const handleDeleteCollection = async (id: string) => {
    try {
      await deleteCollection(id);
    } catch (e) {
      showErrorToast('Failed to delete collection.');
      throw e;
    }
  };

  const handleCollectionPress = (collection: Collection) => {
    router.push(`/(tabs)/(library)/${collection.id}`);
  };

  const primaryColor = colors.primary;

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
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Library</Text>
          <View style={styles.headerActions}>
            {(editing || customCollections.length > 0) && (
              <Pressable
                style={styles.editButton}
                onPress={() => setEditing(!editing)}
                accessibilityRole="button"
                disabled={actionsDisabled}
              >
                <Text style={[styles.editLabel, { color: colors.text }]}>{editing ? 'Done' : 'Edit'}</Text>
              </Pressable>
            )}
            <Pressable
              style={styles.addButton}
              accessibilityRole="button"
              accessibilityLabel="New collection"
              onPress={() => setNameDialog({})}
              disabled={actionsDisabled}
            >
              <IconSymbol name="plus" size={28} color={primaryColor} />
            </Pressable>
          </View>
        </View>

        <GestureDetector gesture={scrollGesture}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.collectionsContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
          }
        >
          {!hydrated ? (
            <CollectionCardSkeleton count={3} />
          ) : (
            <>
              {collections.map((collection, index) => {
                const customIndex = customCollections.indexOf(collection);
                return (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    index={index}
                    onPress={() => handleCollectionPress(collection)}
                    onDelete={() => handleDeleteCollection(collection.id)}
                    onRename={() => setNameDialog({ collection })}
                    onReorder={() => setEditing(true)}
                    actionsDisabled={actionsDisabled}
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
            </>
          )}
        </ScrollView>
        </GestureDetector>

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
      </View>
    </ReviewNowProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 16,
  },
  title: {
    fontSize: 34,
    fontWeight: 'bold',
  },
  addButton: {
    padding: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
