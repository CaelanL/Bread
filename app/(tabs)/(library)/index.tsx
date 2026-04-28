import { IconSymbol } from '@/components/ui/icon-symbol';
import { AddCollectionModal } from '@/components/library/AddCollectionModal';
import { SwipeableCollectionCard } from '@/components/library/SwipeableCollectionCard';
import { CollectionCardSkeleton } from '@/components/library/CollectionCardSkeleton';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { type Collection, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { useAppStore, useCollections, useHydrated, useCollectionVerseCount, useDueCounts, useInProgressVerseCount, useMasteredVerseCount } from '@/lib/store';
import { ReviewNowProvider, useReviewNow, useReviewNowValue } from '@/hooks/use-review-now';
import { showErrorToast } from '@/lib/toast';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

interface CollectionWithCount extends Collection {
  verseCount: number;
}

// Component to get verse count for a collection
function CollectionCard({
  collection,
  index,
  onPress,
  onDelete,
}: {
  collection: Collection;
  index: number;
  onPress: () => void;
  onDelete: () => void;
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
  const collectionWithCount: CollectionWithCount = { ...collection, verseCount };
  const dueCount = isMastered ? dueCounts.mastered : 0;

  return (
    <SwipeableCollectionCard
      collection={collectionWithCount}
      index={index}
      onPress={onPress}
      onDelete={onDelete}
      dueCount={dueCount}
    />
  );
}

export default function LibraryScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const now = useReviewNow();

  // Store data
  const allCollections = useCollections();
  const inProgressCount = useInProgressVerseCount();
  const collections = inProgressCount > 0
    ? allCollections
    : allCollections.filter((c) => c.id !== IN_PROGRESS_COLLECTION_ID);
  const hydrated = useHydrated();
  const addCollection = useAppStore((s) => s.addCollection);
  const deleteCollection = useAppStore((s) => s.deleteCollection);
  const refresh = useAppStore((s) => s.refresh);

  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
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
      throw e; // Re-throw so SwipeableCollectionCard can handle animation
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
          <Pressable
            style={styles.addButton}
            onPress={() => setModalVisible(true)}
          >
            <IconSymbol name="plus" size={28} color={primaryColor} />
          </Pressable>
        </View>

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
              {collections.map((collection, index) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  index={index}
                  onPress={() => handleCollectionPress(collection)}
                  onDelete={() => handleDeleteCollection(collection.id)}
                />
              ))}
              {collections.length <= 1 && renderEmptyHint()}
            </>
          )}
        </ScrollView>

        <AddCollectionModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          onAdd={handleAddCollection}
        />
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
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  collectionsContainer: {
    padding: 16,
    gap: 12,
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
