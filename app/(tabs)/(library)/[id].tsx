import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SwipeableVerseCard } from '@/components/library/SwipeableVerseCard';
import { VerseCardSkeleton } from '@/components/library/VerseCardSkeleton';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatVerseReference, type SavedVerse, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { useAppStore, useVersesByCollection, useCollection, useHydrated, useMasteredVerses } from '@/lib/store';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';

export default function CollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Check if this is the Mastered collection
  const isMasteredCollection = id === MASTERED_COLLECTION_ID;

  // Store data
  const collection = useCollection(id || '');
  const collectionVerses = useVersesByCollection(id || '');
  const masteredVerses = useMasteredVerses();
  const hydrated = useHydrated();
  const deleteVerse = useAppStore((s) => s.deleteVerse);
  const refresh = useAppStore((s) => s.refresh);

  // Use mastered verses for the Mastered collection, otherwise use collection verses
  const verses = isMasteredCollection ? masteredVerses : collectionVerses;

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const handleAddVerse = () => {
    router.push(`/(tabs)/(library)/add?collectionId=${id}`);
  };

  const handleVersePress = (verse: SavedVerse) => {
    router.push(`/(tabs)/(library)/setup/${verse.id}`);
  };

  const handleDeleteVerse = async (verseId: string) => {
    if (!id) return;
    await deleteVerse(verseId, id);
  };

  const primaryColor = colors.primary;

  // Sort verses by createdAt descending
  const sortedVerses = [...verses].sort((a, b) => b.createdAt - a.createdAt);

  const renderEmptyState = () => {
    // Mastered collection empty state
    if (isMasteredCollection) {
      return (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: 'rgba(34,197,94,0.12)' }]}>
            <IconSymbol name="checkmark.circle.fill" size={40} color={colors.success} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No mastered verses yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
            Complete hard mode with 90%+ accuracy to master a verse
          </Text>
        </View>
      );
    }

    // Regular collection empty state
    return (
      <View style={styles.emptyState}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.primaryLight }]}>
          <IconSymbol name="book.closed" size={40} color={colors.icon} />
        </View>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No verses yet</Text>
        <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
          Add your first verse to start memorizing
        </Text>
        <Pressable
          style={[styles.emptyButton, { backgroundColor: primaryColor }]}
          onPress={handleAddVerse}
        >
          <IconSymbol name="plus" size={18} color={colors.white} />
          <Text style={styles.emptyButtonText}>Add Verse</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={collection?.name || 'Collection'}
        rightButton={
          collection?.isVirtual
            ? undefined
            : {
                label: 'Add',
                icon: 'plus',
                onPress: handleAddVerse,
              }
        }
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={!hydrated || sortedVerses.length === 0 ? styles.emptyContainer : styles.versesContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
        }
      >
        {!hydrated ? (
          <View style={styles.skeletonContainer}>
            <VerseCardSkeleton count={3} />
          </View>
        ) : sortedVerses.length === 0 ? (
          renderEmptyState()
        ) : (
          sortedVerses.map((v, i) => (
            <SwipeableVerseCard
              key={v.id}
              verse={v}
              index={i}
              onPress={() => handleVersePress(v)}
              onDelete={() => handleDeleteVerse(v.id)}
              disableSwipe={isMasteredCollection}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  skeletonContainer: {
    padding: 16,
  },
  versesContainer: {
    padding: 16,
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 40,
    marginBottom: 8,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 8,
  },
  emptyButtonText: {
    color: '#fff', // Always white on colored button
    fontSize: 16,
    fontWeight: '600',
  },
});
