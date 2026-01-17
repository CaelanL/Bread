import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SwipeableVerseCard } from '@/components/library/SwipeableVerseCard';
import { VerseCardSkeleton } from '@/components/library/VerseCardSkeleton';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatVerseReference, type SavedVerse, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { filterVerses } from '@/lib/search';
import { useAppStore, useVersesByCollection, useCollection, useHydrated, useMasteredVerses, useVerses } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
  const allVerses = useVerses();
  const hydrated = useHydrated();
  const deleteVerse = useAppStore((s) => s.deleteVerse);
  const refresh = useAppStore((s) => s.refresh);

  // Count how many collections each verse is in (by matching book/chapter/verse/version)
  const getVerseCollectionCount = (verse: SavedVerse): number => {
    return allVerses.filter(
      (v) =>
        v.book === verse.book &&
        v.chapter === verse.chapter &&
        v.verseStart === verse.verseStart &&
        v.verseEnd === verse.verseEnd &&
        v.version === verse.version
    ).length;
  };

  // Use mastered verses for the Mastered collection, otherwise use collection verses
  const verses = isMasteredCollection ? masteredVerses : collectionVerses;

  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'alphabetical' | 'mastery'>('recent');

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
    try {
      await deleteVerse(verseId, id);
    } catch (e) {
      showErrorToast('Failed to delete verse. Please try again.');
      throw e; // Re-throw so SwipeableVerseCard can handle animation
    }
  };

  const primaryColor = colors.primary;

  // Filter verses by search query (progressive filtering)
  const filteredVerses = filterVerses(verses, searchQuery);

  // Sort verses based on sortBy
  const sortedVerses = [...filteredVerses].sort((a, b) => {
    switch (sortBy) {
      case 'alphabetical':
        const refA = formatVerseReference(a);
        const refB = formatVerseReference(b);
        return refA.localeCompare(refB);
      case 'mastery':
        // Sort by mastery level: engraved > hard > medium > easy > none
        const getMasteryLevel = (v: SavedVerse) => {
          if (v.progress.engraved?.completed) return 4;
          if (v.progress.hard.completed) return 3;
          if (v.progress.medium.completed) return 2;
          if (v.progress.easy.completed) return 1;
          return 0;
        };
        return getMasteryLevel(b) - getMasteryLevel(a);
      case 'recent':
      default:
        return b.createdAt - a.createdAt;
    }
  });

  const cycleSortBy = () => {
    setSortBy((current) => {
      switch (current) {
        case 'recent': return 'alphabetical';
        case 'alphabetical': return 'mastery';
        case 'mastery': return 'recent';
      }
    });
  };

  const getSortLabel = () => {
    switch (sortBy) {
      case 'recent': return 'Recent';
      case 'alphabetical': return 'A-Z';
      case 'mastery': return 'Mastery';
    }
  };

  const renderEmptyState = () => {
    // No search results
    if (searchQuery.trim() && verses.length > 0) {
      return (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <IconSymbol name="magnifyingglass" size={40} color={colors.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No matches</Text>
          <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
            Try a different search term
          </Text>
        </View>
      );
    }

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
                icon: 'plus',
                onPress: handleAddVerse,
                variant: 'icon',
              }
        }
      />

      {/* Search and Sort Bar */}
      {hydrated && verses.length > 0 && (
        <View style={styles.searchContainer}>
          <View style={[styles.searchBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}>
            <IconSymbol name="magnifyingglass" size={16} color={colors.icon} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search verses..."
              placeholderTextColor={colors.icon}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          <Pressable
            style={[styles.sortButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
            onPress={cycleSortBy}
          >
            <IconSymbol name="arrow.up.arrow.down" size={14} color={colors.icon} />
            <Text style={[styles.sortLabel, { color: colors.icon }]}>{getSortLabel()}</Text>
          </Pressable>
        </View>
      )}

      {!hydrated ? (
        <View style={styles.skeletonContainer}>
          <VerseCardSkeleton count={3} />
        </View>
      ) : (
        <FlatList
          data={sortedVerses}
          renderItem={({ item }) => (
            <SwipeableVerseCard
              verse={item}
              onPress={() => handleVersePress(item)}
              onDelete={() => handleDeleteVerse(item.id)}
              disableSwipe={isMasteredCollection}
              collectionCount={getVerseCollectionCount(item)}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={sortedVerses.length === 0 ? styles.emptyContainer : styles.versesContainer}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
  },
  sortLabel: {
    fontSize: 13,
    fontWeight: '500',
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
