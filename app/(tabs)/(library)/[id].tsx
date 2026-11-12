import { AppHeader } from '@/components/app-header';
import { CollectionIconPicker } from '@/components/library/CollectionIconPicker';
import { SharedCollectionSheet } from '@/components/shared/SharedCollectionSheet';
import { SharedStrip } from '@/components/shared/SharedStrip';
import { CopyToCollectionModal } from '@/components/ui/CopyToCollectionModal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SwipeableVerseCard } from '@/components/library/SwipeableVerseCard';
import { VerseCardSkeleton } from '@/components/library/VerseCardSkeleton';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { useAuth } from '@/lib/auth';
import {
  buildGrid,
  cellState,
  groupProgress,
  masteredByEveryoneCount,
  openVersesFor,
  progressFlags,
  referenceKey,
  replaceMemberCells,
} from '@/lib/shared/progress';
import { type SavedVerse, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { resolveCollectionIcon } from '@/lib/collections/icons';
import { filterVerses } from '@/lib/search';
import { useAppStore, useCollection, useCollectionSort, useHydrated, useInProgressVerses, useMasteredVerses, useSharedCollection, useVerses, useVersesByCollection } from '@/lib/store';
import { cycleSort, getSortLabel, sortVerses } from '@/lib/store/library-sort';
import { isDueForReview } from '@/lib/store/review';
import { ReviewNowProvider, useReviewNow } from '@/hooks/use-review-now';
import { showErrorToast } from '@/lib/toast';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Check if this is a virtual collection
  const isMasteredCollection = id === MASTERED_COLLECTION_ID;
  const isInProgressCollection = id === IN_PROGRESS_COLLECTION_ID;

  // Store data
  const collection = useCollection(id || '');
  const collectionVerses = useVersesByCollection(id || '');
  const masteredVerses = useMasteredVerses();
  const inProgressVerses = useInProgressVerses();
  const allVerses = useVerses();
  const hydrated = useHydrated();
  const deleteVerse = useAppStore((s) => s.deleteVerse);
  const refresh = useAppStore((s) => s.refresh);
  const shared = useSharedCollection(id || '');
  const sharedId = collection?.sharedId;
  // Plain members of a shared collection read it; the owner and editors add and remove.
  const canEdit = !sharedId || shared?.role === 'owner' || shared?.role === 'editor';
  const [sharedSheetOpen, setSharedSheetOpen] = useState(false);
  const { user } = useAuth();
  const sharedProgress = useAppStore((s) => (sharedId ? s.sharedProgress[sharedId] : undefined));
  const [openOnly, setOpenOnly] = useState(false);

  // Members × references, with your own squares from your verses here so they match your cards
  // the moment a session saves.
  const grid = useMemo(() => {
    if (!sharedId || !user || !sharedProgress?.fetchedAt) return null;
    const own = collectionVerses.map((v) => ({ userId: user.id, book: v.book, chapter: v.chapter,
      verseStart: v.verseStart, verseEnd: v.verseEnd, ...progressFlags(v.progress) }));
    return buildGrid(sharedProgress.members.map((m) => m.userId), sharedProgress.references,
      replaceMemberCells(sharedProgress.cells, user.id, own));
  }, [sharedId, user, sharedProgress, collectionVerses]);
  const groupRows = useMemo(() => new Map(grid?.rows.map((row) => [row.key, row])), [grid]);
  const openKeys = useMemo(
    () => new Set(grid && user ? openVersesFor(user.id, grid).map(referenceKey) : []),
    [grid, user],
  );

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

  // Source verses by collection: Mastered + In Progress are virtual.
  const verses = isMasteredCollection
    ? masteredVerses
    : isInProgressCollection
      ? inProgressVerses
      : collectionVerses;

  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const canChangeIcon = collection && !collection.isDefault && !collection.isVirtual
    && (!sharedId || shared?.role === 'owner');
  const collectionIcon = resolveCollectionIcon(collection?.iconKey);
  const [copyingVerse, setCopyingVerse] = useState<SavedVerse | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const sortBy = useCollectionSort(id || '');
  const setCollectionSort = useAppStore((s) => s.setCollectionSort);

  useEffect(() => {
    if (!copyNotice) return;
    AccessibilityInfo.announceForAccessibility(copyNotice);
    const timer = setTimeout(() => setCopyNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [copyNotice]);

  // Opening a shared collection brings this copy up to date with the group, then reads the grid,
  // once per visit.
  const syncedId = useRef<string | null>(null);
  const syncShared = async (target: string) => {
    try {
      await useAppStore.getState().openSharedCollection(target);
    } catch {
      showErrorToast("Couldn't update this shared collection. Pull to refresh to try again.");
    }
  };
  useEffect(() => {
    if (!sharedId || syncedId.current === sharedId) return;
    syncedId.current = sharedId;
    void syncShared(sharedId);
  }, [sharedId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    if (sharedId) await syncShared(sharedId);
    setRefreshing(false);
  };

  const backToLibrary = () => {
    if ((navigation.getState()?.index ?? 0) > 0) router.back();
    else router.replace('/(tabs)/(library)');
  };

  const handleAddVerse = useDebouncedPress(() => {
    router.push(`/(tabs)/(library)/add?collectionId=${id}`);
  });

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
  const showOpenOnly = openOnly && openKeys.size > 0;
  const filteredVerses = filterVerses(
    showOpenOnly ? verses.filter((v) => openKeys.has(referenceKey(v))) : verses,
    searchQuery,
  );

  // Sort verses based on sortBy
  const now = useReviewNow();
  const sortedVerses = sortVerses(filteredVerses, sortBy, now);

  const dueCount = useMemo(
    () => (isMasteredCollection ? sortedVerses.filter((v) => isDueForReview(v, now)).length : 0),
    [isMasteredCollection, sortedVerses, now],
  );

  const cycleSortBy = () => {
    if (!id) return;
    const next = cycleSort(sortBy, isMasteredCollection);
    setCollectionSort(id, next);
  };

  const sortLabel = getSortLabel(sortBy);

  // Today's session on your first open verse, in this list's order: the same setup screen a tap opens.
  const practiceOpen = useDebouncedPress(() => {
    const first = sortVerses(verses.filter((v) => openKeys.has(referenceKey(v))), sortBy, now)[0];
    if (first) router.push(`/(tabs)/(library)/setup/${first.id}`);
  });

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

    if (!canEdit) {
      return (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primaryLight }]}>
            <IconSymbol name="book.closed" size={40} color={colors.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No verses yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.icon }]}>
            Verses the owner adds show up here
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
    <ReviewNowProvider value={now}>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={collection?.name || 'Collection'}
        leftButton={{
          icon: 'chevron.left',
          label: 'Back',
          onPress: backToLibrary,
        }}
        titleIcon={canChangeIcon ? {
          name: collectionIcon.symbol,
          label: `Change collection icon, ${collectionIcon.label}`,
          onPress: () => setIconPickerOpen(true),
        } : undefined}
        rightButton={
          collection?.isVirtual || !canEdit
            ? undefined
            : {
                icon: 'plus',
                onPress: handleAddVerse,
                variant: 'icon',
              }
        }
      />

      {sharedId && (
        <SharedStrip
          memberNames={sharedProgress?.fetchedAt ? sharedProgress.members.map((m) => m.displayName) : null}
          memberCount={sharedProgress?.fetchedAt ? sharedProgress.members.length : shared?.memberCount ?? 1}
          verseCount={sharedProgress?.fetchedAt ? sharedProgress.references.length : shared?.verseCount ?? verses.length}
          progress={grid ? { ratio: groupProgress(grid), masteredByEveryone: masteredByEveryoneCount(grid) } : null}
          failed={sharedProgress?.failed ?? false}
          onOpen={() => setSharedSheetOpen(true)}
          onRetry={() => void useAppStore.getState().fetchSharedProgress(sharedId)}
        />
      )}

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
          {openKeys.size > 0 && (
            <Pressable
              testID="open-verses-filter"
              accessibilityRole="button"
              accessibilityState={{ selected: showOpenOnly }}
              accessibilityLabel={`Only your open verses, ${openKeys.size}`}
              style={[styles.sortButton, { backgroundColor: showOpenOnly ? colors.primary : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
              onPress={() => setOpenOnly(!showOpenOnly)}
            >
              <Text style={[styles.sortLabel, { color: showOpenOnly ? colors.white : colors.icon }]}>Open · {openKeys.size}</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.sortButton, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
            onPress={cycleSortBy}
          >
            <IconSymbol name="arrow.up.arrow.down" size={14} color={colors.icon} />
            <Text style={[styles.sortLabel, { color: colors.icon }]}>{sortLabel}</Text>
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
              onCopy={() => {
                setCopyNotice(null);
                setCopyingVerse(item);
              }}
              disableSwipe={isMasteredCollection || isInProgressCollection || !canEdit}
              collectionCount={getVerseCollectionCount(item)}
              sharedMemberCount={sharedId ? shared?.memberCount ?? 1 : undefined}
              group={sharedId ? {
                you: cellState(progressFlags(item.progress)),
                states: groupRows.get(referenceKey(item))?.states ?? null,
                unavailable: sharedProgress?.failed ?? false,
              } : undefined}
            />
          )}
          keyExtractor={(item) => item.id}
          contentContainerStyle={sortedVerses.length === 0
            ? styles.emptyContainer
            : [styles.versesContainer, openKeys.size > 0 && styles.versesAbovePractice]}
          ListHeaderComponent={sharedId && sortedVerses.length > 0 ? (
            <View style={styles.columns}>
              <Text style={[styles.columnLabel, { color: colors.icon }]}>You · Verse</Text>
              <Text style={[styles.columnLabel, { color: colors.icon }]}>Group</Text>
            </View>
          ) : undefined}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
          }
        />
      )}
      {sharedId && openKeys.size > 0 && (
        <View style={styles.practiceWrap} pointerEvents="box-none">
          <Pressable
            testID="practice-open"
            accessibilityRole="button"
            onPress={practiceOpen}
            style={({ pressed }) => [styles.practice, { backgroundColor: colors.text, opacity: pressed ? 0.85 : 1 }]}
          >
            <Text style={[styles.practiceText, { color: colors.background }]}>
              Practice your {openKeys.size} open verse{openKeys.size === 1 ? '' : 's'}
            </Text>
          </Pressable>
        </View>
      )}
      {iconPickerOpen && canChangeIcon && (
        <CollectionIconPicker
          currentKey={collection.iconKey}
          onClose={() => setIconPickerOpen(false)}
          onSave={(key) => useAppStore.getState().setCollectionIcon(collection.id, key)}
        />
      )}
      {sharedSheetOpen && id && (
        <SharedCollectionSheet
          collectionId={id}
          onClose={() => setSharedSheetOpen(false)}
          onLeft={() => {
            setSharedSheetOpen(false);
            backToLibrary();
          }}
        />
      )}
      {copyNotice && (
        <View pointerEvents="none" style={styles.noticeContainer}>
          <Text style={[styles.notice, { color: colors.text, backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            {copyNotice}
          </Text>
        </View>
      )}
      {copyingVerse && (
        <CopyToCollectionModal
          verse={copyingVerse}
          onClose={() => setCopyingVerse(null)}
          onCopied={(name) => {
            setCopyingVerse(null);
            setCopyNotice(`Copied to ${name}`);
          }}
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
  noticeContainer: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  notice: {
    borderRadius: Radius.huge,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '500',
  },
  columns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  versesAbovePractice: {
    paddingBottom: 96,
  },
  practiceWrap: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  practice: {
    height: 48,
    paddingHorizontal: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  practiceText: {
    fontSize: 16,
    fontWeight: '600',
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
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
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
