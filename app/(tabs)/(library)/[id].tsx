import { AddCollectionModal } from '@/components/library/AddCollectionModal';
import { CollectionHeader, groupProgressLabel, HeaderPill } from '@/components/library/CollectionHeader';
import { CollectionIconPicker } from '@/components/library/CollectionIconPicker';
import { confirmDeleteCollection, confirmDeleteForEveryone, confirmLeave, confirmStopSharing } from '@/components/shared/confirm-removal';
import { InviteLine } from '@/components/shared/InviteLine';
import { CopyToCollectionModal } from '@/components/ui/CopyToCollectionModal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { SearchTakeover, type SearchOrigin } from '@/components/ui/SearchTakeover';
import { TopBar, TopBarButton, useScrollY, useTopBarHeight } from '@/components/ui/TopBar';
import { SwipeableVerseCard } from '@/components/library/SwipeableVerseCard';
import { VerseCardSkeleton } from '@/components/library/VerseCardSkeleton';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { useAuth } from '@/lib/auth';
import { useSharedGrid } from '@/hooks/use-shared-grid';
import { MAX_SHARED_COLLECTIONS, shareHitsCap } from '@/lib/shared/constants';
import { listNames } from '@/lib/shared/display-name';
import { sharedErrorMessage } from '@/lib/shared/invite-code';
import { groupProgress, hasOtherMembers, masteredByEveryoneCount, referenceKey, sharedEmblem, soloEmblem } from '@/lib/shared/progress';
import { type SavedVerse, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { resolveCollectionIcon } from '@/lib/collections/icons';
import { filterVerses } from '@/lib/search';
import { useAppStore, useCollection, useCollectionSort, useHydrated, useInProgressVerses, useMasteredVerses, useSharedCollection, useSharedOwnerName, useVerses, useVersesByCollection, useVersesLostWith } from '@/lib/store';
import { cycleSort, getSortLabel, sortVerses } from '@/lib/store/library-sort';
import { isDueForReview } from '@/lib/store/review';
import { ReviewNowProvider, useReviewNow } from '@/hooks/use-review-now';
import { showErrorToast } from '@/lib/toast';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  RefreshControl,
} from 'react-native';
import Animated from 'react-native-reanimated';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
  // The group card and counts show once someone besides the owner joined; until then it reads as personal.
  const withOthers = Boolean(sharedId) && hasOtherMembers(shared);
  const { user } = useAuth();
  const { sharedProgress, grid } = useSharedGrid(sharedId, collectionVerses);
  const storedOwnerName = useSharedOwnerName(id || '');
  const isOwner = !sharedId || shared?.role === 'owner';
  const isCustom = Boolean(collection && !collection.isDefault && !collection.isVirtual);
  // A member's delete is Leave; only the owner shares, renames and stops sharing.
  const isLeave = Boolean(sharedId) && !isOwner;
  const lostCount = useVersesLostWith(id || '');
  const sharedCount = useAppStore((s) => Object.keys(s.sharedCollections).length);
  const barHeight = useTopBarHeight();
  const { scrollY, onScroll } = useScrollY();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Set while search is open: where its pill sat, so the field grows from there and goes back.
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const searchPill = useRef<View>(null);
  const openSearch = () => {
    searchPill.current?.measureInWindow((x, y, width, height) => setSearchOrigin({ x, y, width, height }));
  };
  // A modal route (the share card) can present over this screen; its RN Modals must not stay up under it.
  useFocusEffect(useCallback(() => () => {
    setMenuOpen(false);
    setRenaming(false);
  }, []));
  const groupRows = useMemo(() => new Map(grid?.rows.map((row) => [row.key, row])), [grid]);

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
  const backToLibrary = useCallback(() => {
    if ((navigation.getState()?.index ?? 0) > 0) router.back();
    else router.replace('/(tabs)/(library)');
  }, [navigation]);
  const syncShared = useCallback(async (target: string) => {
    try {
      const shared = await useAppStore.getState().openSharedCollection(target);
      // Removed or left elsewhere: the copy is gone (a dissolved copy stays, now personal).
      if (!shared && !useAppStore.getState().collections.some((c) => c.id === id)) backToLibrary();
    } catch {
      showErrorToast("Couldn't update this shared collection. Pull to refresh to try again.");
    }
  }, [id, backToLibrary]);
  useEffect(() => {
    if (!sharedId || syncedId.current === sharedId) return;
    syncedId.current = sharedId;
    void syncShared(sharedId);
  }, [sharedId, syncShared]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    if (sharedId) await syncShared(sharedId);
    setRefreshing(false);
  };

  const handleAddVerse = useDebouncedPress(() => {
    router.push(`/(tabs)/(library)/add?collectionId=${id}`);
  });

  const showGrid = useDebouncedPress(() => {
    router.push(`/(tabs)/(library)/shared/${id}`);
  });

  // The share card is a route, never an RN Modal held here: see ModalCard. Sharing a personal
  // collection makes its code; it stays personal until someone joins.
  const share = useDebouncedPress(() => {
    if (shareHitsCap(sharedId, sharedCount)) {
      showErrorToast(`${MAX_SHARED_COLLECTIONS} shared collections is the limit.`);
      return;
    }
    router.push(`/share/${id}`);
  });

  const showMembers = useDebouncedPress(() => {
    router.push(`/share/${id}?view=members`);
  });

  const removeCollection = () => {
    if (!collection) return;
    const confirm = async () => {
      backToLibrary();
      try {
        await useAppStore.getState().deleteCollection(collection.id);
      } catch (e) {
        showErrorToast(sharedErrorMessage(e, isLeave ? "Couldn't leave this collection. Try again." : 'Failed to delete collection.'));
      }
    };
    if (isLeave) confirmLeave(collection.name, lostCount, confirm);
    else if (withOthers) confirmDeleteForEveryone(lostCount, confirm);
    else confirmDeleteCollection(collection.name, verses.length, confirm);
  };

  const stopSharing = () => {
    if (!collection || !sharedId) return;
    const others = sharedProgress?.fetchedAt
      ? sharedProgress.members.filter((m) => m.userId !== user?.id).map((m) => m.displayName)
      : Math.max((shared?.memberCount ?? 1) - 1, 0);
    confirmStopSharing(collection.name, withOthers ? others : 0, async () => {
      try {
        await useAppStore.getState().stopSharing(sharedId);
      } catch (e) {
        showErrorToast(sharedErrorMessage(e, "Couldn't stop sharing. Try again."));
      }
    });
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
  const now = useReviewNow();
  const sortedVerses = sortVerses(filteredVerses, sortBy, now);
  // The list under the header; search shows `sortedVerses` in its own list over it.
  const allSorted = searchQuery ? sortVerses(verses, sortBy, now) : sortedVerses;

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

  const emblem = useMemo(() => {
    if (!collection || collection.isVirtual) return null;
    if (withOthers && shared) return sharedEmblem(shared);
    return soloEmblem(collectionVerses.map((v) => v.progress));
  }, [collection, withOthers, shared, collectionVerses]);
  const verseCount = sharedProgress?.fetchedAt && withOthers ? sharedProgress.references.length : verses.length;
  const verseLine = verseCount === 0 ? 'No verses yet' : plural(verseCount, 'verse');
  const members = withOthers && sharedProgress?.fetchedAt
    ? sharedProgress.members.map((m) => ({ name: m.displayName, you: m.userId === user?.id }))
    : null;
  const memberCount = members?.length ?? shared?.memberCount ?? 1;
  const people = withOthers ? {
    members,
    count: memberCount,
    line: `${members ? listNames(members.map((m) => m.name)) : [storedOwnerName, plural(memberCount, 'member')].filter(Boolean).join(' · ')} · ${verseLine}`,
    onPress: showMembers,
  } : undefined;
  const progress = grid ? { ratio: groupProgress(grid), masteredByEveryone: masteredByEveryoneCount(grid) } : null;
  const symbol = (collection?.icon as SymbolViewProps['name']) || (collection?.isDefault ? 'heart.fill' : collectionIcon.symbol);
  const name = collection?.name ?? (hydrated ? 'Collection' : '');

  const menuItems = [
    ...(withOthers ? [{ label: 'Details', icon: 'info.circle', onPress: showGrid }] : []),
    ...(canChangeIcon ? [{ label: 'Change icon', icon: 'square.grid.2x2', onPress: () => setIconPickerOpen(true) }] : []),
    ...(isCustom && !isLeave ? [{ label: 'Rename', icon: 'pencil', onPress: () => setRenaming(true) }] : []),
    ...(sharedId && isOwner ? [{ label: 'Stop sharing', icon: 'person.2.slash', onPress: stopSharing }] : []),
    ...(isCustom ? [isLeave
      ? { label: 'Leave', icon: 'rectangle.portrait.and.arrow.right', onPress: removeCollection, destructive: true }
      : { label: 'Delete', icon: 'trash', onPress: removeCollection, destructive: true }] : []),
  ];

  const renderVerse = ({ item }: { item: SavedVerse }) => (
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
      sharedMemberCount={withOthers ? shared?.memberCount : undefined}
      group={withOthers ? {
        states: groupRows.get(referenceKey(item))?.states ?? null,
        unavailable: sharedProgress?.failed ?? false,
      } : undefined}
    />
    );
  const divider = () => <View style={[styles.divider, { backgroundColor: colors.border }]} />;

  const header = (
    <CollectionHeader
      symbol={symbol}
      accent={collection?.iconColor ?? colors.primary}
      emblem={emblem}
      iconLabel={`Change collection icon, ${collectionIcon.label}`}
      onIconPress={canChangeIcon ? () => setIconPickerOpen(true) : undefined}
      name={name}
      people={people}
      subtitle={hydrated ? (emblem ? `${emblem === 'engraved' ? 'Engraved' : 'Mastered'} · ${verseLine}` : verseLine) : undefined}
      invite={sharedId && !withOthers && isOwner
        ? <InviteLine sharedId={sharedId} name={name} onManage={share} />
        : undefined}
      progress={withOthers && sharedId ? {
        ratio: progress?.ratio ?? null,
        label: groupProgressLabel(progress, verseCount),
        failed: sharedProgress?.failed ?? false,
        onPress: showGrid,
        onRetry: () => void useAppStore.getState().fetchSharedProgress(sharedId),
      } : undefined}
    >
      {hydrated && verses.length > 0 && (
        <>
          <HeaderPill ref={searchPill} testID="collection-search-open" icon="magnifyingglass" label="Search" onPress={openSearch} hidden={Boolean(searchOrigin)} />
          <HeaderPill testID="collection-sort" icon="arrow.up.arrow.down" label={sortLabel} accessibilityLabel={`Sort, ${sortLabel}`} onPress={cycleSortBy} />
          <View style={styles.spacer} />
          {!collection?.isVirtual && canEdit && <HeaderPill testID="collection-add" icon="plus" label="Add" accessibilityLabel="Add verses" onPress={handleAddVerse} primary />}
        </>
      )}
    </CollectionHeader>
  );

  return (
    <ReviewNowProvider value={now}>
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.FlatList
        data={hydrated ? allSorted : []}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        renderItem={renderVerse}
        ItemSeparatorComponent={divider}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingTop: barHeight }]}
        ListEmptyComponent={hydrated ? renderEmptyState : <VerseCardSkeleton count={3} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={barHeight} />
        }
      />
      <TopBar scrollY={scrollY} onBack={backToLibrary}>
        {isCustom && isOwner && (
          <TopBarButton testID="collection-share" icon="person.badge.plus" label={sharedId ? 'Invite and members' : 'Share'} onPress={share} />
        )}
        {menuItems.length > 0 && (
          <TopBarButton testID="collection-menu" icon="ellipsis" label="More" onPress={() => setMenuOpen(true)} />
        )}
      </TopBar>
      {searchOrigin && (
        <SearchTakeover
          origin={searchOrigin}
          query={searchQuery}
          onChangeQuery={setSearchQuery}
          onClose={() => setSearchOrigin(null)}
          placeholder="Search verses"
        >
          <FlatList
            data={sortedVerses}
            renderItem={renderVerse}
            ItemSeparatorComponent={divider}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.content}
            ListEmptyComponent={<Text style={[styles.noMatches, { color: colors.icon }]}>No matches</Text>}
          />
        </SearchTakeover>
      )}
      <PopoverMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorPosition={{ top: barHeight, right: 12 }}
        items={menuItems}
      />
      {renaming && collection && (
        <AddCollectionModal
          visible
          initialName={collection.name}
          onClose={() => setRenaming(false)}
          onAdd={(next) => useAppStore.getState().renameCollection(collection.id, next)}
        />
      )}
      {iconPickerOpen && canChangeIcon && (
        <CollectionIconPicker
          currentKey={collection.iconKey}
          onClose={() => setIconPickerOpen(false)}
          onSave={(key) => useAppStore.getState().setCollectionIcon(collection.id, key)}
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
  content: {
    paddingBottom: 32,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 20,
  },
  noMatches: {
    fontSize: 15,
    textAlign: 'center',
    paddingTop: 32,
  },
  spacer: {
    flex: 1,
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 48,
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
