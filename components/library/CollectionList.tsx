import { sharedErrorMessage } from '@/lib/shared/invite-code';
import { AddCollectionModal } from '@/components/library/AddCollectionModal';
import { CollectionHeader, groupProgressLabel, HeaderPill } from '@/components/library/CollectionHeader';
import { CollectionIconPicker } from '@/components/library/CollectionIconPicker';
import { InviteLine } from '@/components/shared/InviteLine';
import { confirmRemoveCollection, confirmStopSharing } from '@/components/shared/member-actions';
import { CopyToCollectionModal } from '@/components/ui/CopyToCollectionModal';
import { GlassButton } from '@/components/ui/Glass';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { SearchTakeover, type SearchOrigin } from '@/components/ui/SearchTakeover';
import { TopBar, TopBarButton, useMenuAnchor, useTopBarHeight } from '@/components/ui/TopBar';
import { SwipeableVerseCard } from '@/components/library/SwipeableVerseCard';
import { VerseCardSkeleton } from '@/components/library/VerseCardSkeleton';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { useAuth } from '@/lib/auth';
import { useSharedGrid } from '@/hooks/use-shared-grid';
import { MAX_SHARED_COLLECTIONS, shareHitsCap } from '@/lib/shared/constants';
import { listNames } from '@/lib/shared/display-name';
import { canEditShared, collectionRemoval, groupProgress, hasOtherMembers, masteredByEveryoneCount, sharedEmblem, soloEmblem } from '@/lib/shared/progress';
import { referenceKey } from '@/lib/store/translation';
import { type SavedVerse, IN_PROGRESS_COLLECTION_ID, MASTERED_COLLECTION_ID } from '@/lib/storage';
import { resolveCollectionIcon } from '@/lib/collections/icons';
import { filterVerses } from '@/lib/search';
import { librarySynced, useAppStore, useCollection, useCollectionSort, useHydrated, useSynced, useInProgressVerses, useMasteredVerses, useSharedCollection, useSharedOwnerName, useVerses, useVersesByCollection } from '@/lib/store';
import { cycleSort, getSortLabel, sortVerses } from '@/lib/store/library-sort';
import { isDueForReview } from '@/lib/store/review';
import { ReviewNowProvider, useReviewNow } from '@/hooks/use-review-now';
import { showErrorToast } from '@/lib/toast';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewInstance,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// On a wide window: the glass buttons' row, and where the header starts under it (the Final boards).
const WIDE_BUTTONS_TOP = 16;
const WIDE_HEADER_TOP = 64;

/** Back from a collection: to the screen under it, or the Library when it was opened straight from a link. */
export function useBackToLibrary() {
  const navigation = useNavigation();
  return useCallback(() => {
    if ((navigation.getState()?.index ?? 0) > 0) router.back();
    else router.replace('/(tabs)/(library)');
  }, [navigation]);
}

/**
 * A collection's screen body: header, pills, search, sort, verse rows, swipe and copy, empty states,
 * toasts and the collection's menus. On a phone it's the whole screen, with its `TopBar`. On a wide
 * window (`wide`) it's the left pane: no bar (the screen draws back and the sidebar button, and its
 * own actions sit at the pane's top right as glass), a row tap selects the verse instead of
 * opening setup, keeping a row selected while there is one, and Details (the progress line, the people
 * line, the menu) opens in the right pane instead of being pushed.
 */
export function CollectionList({ id, wide, onDetails, onVerse }: {
  id: string;
  /** Details opened (also on a phone, so an unfold lands on them) or left for a verse on a wide window. */
  onDetails?: (shown: boolean) => void;
  /** A row tapped: selected on a wide window, and on a phone too, so an unfold from its setup lands on it. */
  onVerse?: (verseId: string) => void;
  wide?: {
    width: number;
    selectedId: string | undefined;
    onSelect: (verseId: string | undefined) => void;
    /** The right pane shows the group's Details, not the selected verse. */
    details: boolean;
  };
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Check if this is a virtual collection
  const isMasteredCollection = id === MASTERED_COLLECTION_ID;
  const isInProgressCollection = id === IN_PROGRESS_COLLECTION_ID;

  // Store data
  const collection = useCollection(id);
  const collectionVerses = useVersesByCollection(id);
  const masteredVerses = useMasteredVerses();
  const inProgressVerses = useInProgressVerses();
  const allVerses = useVerses();
  const hydrated = useHydrated();
  // An id the saved library doesn't know (made on another device) waits for the server's, which
  // retries once and toasts if it can't be read; then the screen shows it as missing.
  const synced = useSynced();
  const [syncFailed, setSyncFailed] = useState(false);
  const known = synced || !!collection || syncFailed;
  const unknownId = !synced && !collection;
  useEffect(() => {
    if (unknownId) void librarySynced().then((ok) => setSyncFailed(!ok));
  }, [unknownId]);
  const deleteVerse = useAppStore((s) => s.deleteVerse);
  const refresh = useAppStore((s) => s.refresh);
  const shared = useSharedCollection(id);
  const sharedId = collection?.sharedId;
  // Plain members of a shared collection read it; the owner and editors add and remove.
  const canEdit = !sharedId || canEditShared(shared?.role);
  // The group card and counts show once someone besides the owner joined; until then it reads as personal.
  const withOthers = Boolean(sharedId) && hasOtherMembers(shared);
  const { user } = useAuth();
  const { sharedProgress, grid } = useSharedGrid(sharedId, collectionVerses);
  const storedOwnerName = useSharedOwnerName(id);
  // A member's delete is Leave; only the owner shares, renames and stops sharing. Neither while
  // the role loads.
  const removal = collectionRemoval(sharedId, shared?.role);
  const isOwner = removal === 'delete';
  const isLeave = removal === 'leave';
  const isCustom = Boolean(collection && !collection.isDefault && !collection.isVirtual);
  const sharedCount = useAppStore((s) => Object.keys(s.sharedCollections).length);
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const barHeight = useTopBarHeight();
  const contentTop = wide ? insets.top + WIDE_HEADER_TOP : barHeight;
  const barMenuAnchor = useMenuAnchor();
  // Under the pane's glass ⋯, which sits at its top right.
  const menuAnchor = wide
    ? { top: insets.top + WIDE_BUTTONS_TOP + 44 + 8, right: windowWidth - wide.width + 16 }
    : barMenuAnchor;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Set while search is open: where its pill sat, so the field grows from there and goes back.
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const searchPill = useRef<ViewInstance>(null);
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

  // Opening a collection warms its verses' text ahead of the launch preload, once per visit.
  useEffect(() => {
    if (hydrated) useAppStore.getState().preloadVerseText(verses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, hydrated]);

  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const canChangeIcon = collection && !collection.isDefault && !collection.isVirtual && isOwner;
  const collectionIcon = resolveCollectionIcon(collection?.iconKey);
  const [copyingVerse, setCopyingVerse] = useState<SavedVerse | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const sortBy = useCollectionSort(id);
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
  const backToLibrary = useBackToLibrary();
  const syncShared = useCallback(async (target: string, pull = false) => {
    try {
      const shared = await useAppStore.getState().openSharedCollection(target, { pull });
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
    if (sharedId) await syncShared(sharedId, true);
    else await refresh();
    setRefreshing(false);
  };

  const handleAddVerse = useDebouncedPress(() => {
    router.push(`/(tabs)/(library)/add?collectionId=${id}`);
  });

  // On a wide window Details opens beside the list, with the read the phone's Details page makes per visit.
  const openDetails = () => {
    onDetails?.(true);
    if (!wide) return false;
    if (!wide.details && sharedId) void useAppStore.getState().fetchSharedProgress(sharedId);
    return true;
  };

  const showGrid = useDebouncedPress(() => {
    if (!openDetails()) router.push(`/(tabs)/(library)/shared/${id}`);
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

  // On a wide window the members are in Details.
  const showMembers = useDebouncedPress(() => {
    if (!openDetails()) router.push(`/share/${id}?view=members`);
  });

  const removeCollection = () => confirmRemoveCollection(id, { onConfirm: backToLibrary });

  const stopSharing = () => {
    if (!collection || !sharedId) return;
    confirmStopSharing(sharedId, collection.name, null, user?.id);
  };

  const handleVersePress = (verse: SavedVerse) => {
    onVerse?.(verse.id);
    if (!wide) router.push(`/(tabs)/(library)/setup/${verse.id}`);
  };

  const handleDeleteVerse = async (verseId: string) => {
    if (!id) return;
    try {
      await deleteVerse(verseId, id);
    } catch (e) {
      showErrorToast(sharedErrorMessage(e, 'Failed to delete verse. Please try again.'));
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

  // On a wide window a row is always selected while there are rows: the first in the current sort
  // until one is tapped, and the first again if the selected one leaves.
  const selectedId = wide?.selectedId;
  const onSelect = wide?.onSelect;
  const firstId = allSorted[0]?.id;
  const selectedListed = allSorted.some((v) => v.id === selectedId);
  useEffect(() => {
    if (!onSelect || !hydrated) return;
    const next = selectedListed ? selectedId : firstId;
    if (next !== selectedId) onSelect(next);
  }, [onSelect, hydrated, selectedListed, selectedId, firstId]);

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
  const symbol = (collection?.icon as SFSymbol) || (collection?.isDefault ? 'heart.fill' : collectionIcon.symbol);
  const name = collection?.name ?? (known ? 'Collection' : '');

  const menuItems = [
    ...(withOthers ? [{ label: 'Details', icon: 'info.circle', onPress: showGrid }] : []),
    ...(canChangeIcon ? [{ label: 'Change icon', icon: 'square.grid.2x2', onPress: () => setIconPickerOpen(true) }] : []),
    ...(isCustom && isOwner ? [{ label: 'Rename', icon: 'pencil', onPress: () => setRenaming(true) }] : []),
    ...(sharedId && isOwner ? [{ label: 'Stop sharing', icon: 'person.2.slash', onPress: stopSharing }] : []),
    ...(isCustom && removal ? [isLeave
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
      selected={wide ? !wide.details && item.id === wide.selectedId : undefined}
      group={withOthers ? {
        states: groupRows.get(referenceKey(item))?.states ?? null,
        unavailable: sharedProgress?.failed ?? false,
      } : undefined}
    />
    );
  const divider = () => <View style={[styles.divider, { backgroundColor: colors.separator }]} />;

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
        selected: wide?.details,
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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListHeaderComponent={header}
        renderItem={renderVerse}
        ItemSeparatorComponent={divider}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.content, { paddingTop: contentTop }]}
        ListEmptyComponent={hydrated && known ? renderEmptyState : <VerseCardSkeleton count={3} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={contentTop} />
        }
      />
      {wide ? (
        <View style={[styles.wideActions, { top: insets.top + WIDE_BUTTONS_TOP }]}>
          {isCustom && isOwner && (
            <GlassButton testID="collection-share" icon="person.badge.plus" label={sharedId ? 'Invite and members' : 'Share'} onPress={share} />
          )}
          {menuItems.length > 0 && (
            <GlassButton testID="collection-menu" icon="ellipsis" label="Collection options" onPress={() => setMenuOpen(true)} />
          )}
        </View>
      ) : (
        <TopBar onBack={backToLibrary}>
          {isCustom && isOwner && (
            <TopBarButton testID="collection-share" icon="person.badge.plus" label={sharedId ? 'Invite and members' : 'Share'} onPress={share} />
          )}
          {menuItems.length > 0 && (
            <TopBarButton testID="collection-menu" icon="ellipsis" label="More" onPress={() => setMenuOpen(true)} />
          )}
        </TopBar>
      )}
      {searchOrigin && (
        <SearchTakeover
          origin={searchOrigin}
          query={searchQuery}
          onChangeQuery={setSearchQuery}
          onClose={() => setSearchOrigin(null)}
          placeholder="Search verses"
          area={wide ? { width: wide.width, top: insets.top + WIDE_HEADER_TOP + 8 } : undefined}
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
        anchorPosition={menuAnchor}
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
  wideActions: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 1,
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
