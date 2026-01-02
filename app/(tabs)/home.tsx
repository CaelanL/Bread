import { AppHeader } from '@/components/app-header';
import { InsightsCard, type InsightsCardRef } from '@/components/home/InsightsCard';
import { VOTMCard } from '@/components/home/VOTMCard';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getCurrentVOTM, getVOTMMasteryCount, hasUserMasteredVOTM, type VOTM } from '@/lib/api/votm';
import { getVerseText } from '@/lib/api/bible';
import { formatVerseReference } from '@/lib/storage';
import { useAppStore, useCollections, useVerses } from '@/lib/store';
import { BlurView } from 'expo-blur';
import { useEffect, useState, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function SkeletonCard({ isDark }: { isDark: boolean }) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const bgColor = colors.cardAlt;
  const shimmerColor = colors.border;

  return (
    <View style={[styles.skeletonCard, { backgroundColor: bgColor }]}>
      {/* Header placeholder */}
      <Animated.View
        style={[styles.skeletonLine, styles.skeletonHeader, { backgroundColor: shimmerColor, opacity: pulseAnim }]}
      />
      {/* Badge placeholder */}
      <Animated.View
        style={[styles.skeletonLine, styles.skeletonBadge, { backgroundColor: shimmerColor, opacity: pulseAnim }]}
      />
      {/* Text lines placeholder */}
      <Animated.View
        style={[styles.skeletonLine, styles.skeletonText, { backgroundColor: shimmerColor, opacity: pulseAnim }]}
      />
      <Animated.View
        style={[styles.skeletonLine, styles.skeletonTextShort, { backgroundColor: shimmerColor, opacity: pulseAnim }]}
      />
      {/* Footer placeholder */}
      <Animated.View
        style={[styles.skeletonLine, styles.skeletonFooter, { backgroundColor: shimmerColor, opacity: pulseAnim }]}
      />
    </View>
  );
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Get user's default Bible version from store
  const defaultVersion = useAppStore((state) => state.bibleVersion);

  // Store data
  const collections = useCollections();
  const verses = useVerses();
  const addVerse = useAppStore((s) => s.addVerse);

  // VOTM state
  const [votm, setVotm] = useState<VOTM | null>(null);
  const [votmLoading, setVotmLoading] = useState(true);
  const [verseText, setVerseText] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [masteryCount, setMasteryCount] = useState(0);
  const [userMastered, setUserMastered] = useState(false);

  // Modal states
  const [expanded, setExpanded] = useState(false);
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Refresh state
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useAppStore((s) => s.refresh);
  const insightsCardRef = useRef<InsightsCardRef>(null);

  // Check if user already has this verse in library
  const userHasVerse = useMemo(() => {
    if (!votm) return false;
    return verses.some(
      (v) =>
        v.book === votm.book &&
        v.chapter === votm.chapter &&
        v.verseStart === votm.verseStart &&
        v.verseEnd === votm.verseEnd
    );
  }, [votm, verses]);

  // Filter collections for picker (exclude Mastered virtual collection)
  const pickableCollections = useMemo(() => {
    return collections.filter((c) => !c.isVirtual);
  }, [collections]);

  // Fetch VOTM data
  const fetchVOTM = async (isRefresh = false) => {
    if (!isRefresh) setVotmLoading(true);
    try {
      const currentVotm = await getCurrentVOTM();
      setVotm(currentVotm);

      if (currentVotm) {
        // Fetch additional data in parallel
        const [count, mastered] = await Promise.all([
          getVOTMMasteryCount(currentVotm),
          hasUserMasteredVOTM(currentVotm),
        ]);
        setMasteryCount(count);
        setUserMastered(mastered);

        // Fetch verse text
        if (!isRefresh) setTextLoading(true);
        try {
          const text = await getVerseText({
            book: currentVotm.book,
            chapter: currentVotm.chapter,
            verseStart: currentVotm.verseStart,
            verseEnd: currentVotm.verseEnd,
            version: defaultVersion,
          } as any);
          setVerseText(text);
        } catch (e) {
          console.error('[HOME] Failed to fetch verse text:', e);
        } finally {
          if (!isRefresh) setTextLoading(false);
        }
      }
    } catch (e) {
      console.error('[HOME] Failed to fetch VOTM:', e);
    } finally {
      if (!isRefresh) setVotmLoading(false);
    }
  };

  // Fetch on mount
  useEffect(() => {
    fetchVOTM();
  }, [defaultVersion]);

  // Pull to refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      fetchVOTM(true),
      refresh(), // Refresh store data (collections, verses, mastered)
      insightsCardRef.current?.refresh(), // Refresh streak
    ]);
    setRefreshing(false);
  };

  const handleVOTMPress = () => {
    if (!votm) return;
    setExpanded(true);
  };

  const handleAddPress = () => {
    if (!votm) return;
    // Pre-select default collection
    const defaultColl = collections.find((c) => c.isDefault);
    if (defaultColl) {
      setSelectedCollections([defaultColl.id]);
    }
    setCollectionPickerVisible(true);
  };

  const toggleCollection = (id: string) => {
    setSelectedCollections((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleAddToCollections = async () => {
    if (!votm || selectedCollections.length === 0) return;

    setAdding(true);
    try {
      // Add verse to each selected collection
      for (const collectionId of selectedCollections) {
        await addVerse(
          {
            book: votm.book,
            chapter: votm.chapter,
            verseStart: votm.verseStart,
            verseEnd: votm.verseEnd,
          },
          collectionId,
          defaultVersion
        );
      }
      setCollectionPickerVisible(false);
      setSelectedCollections([]);
    } catch (e) {
      console.error('[HOME] Failed to add verse:', e);
    } finally {
      setAdding(false);
    }
  };

  const accentColor = colors.tint;
  const badgeBg = colors.primaryLight;

  // Format reference for modals
  const reference = votm
    ? formatVerseReference({
        book: votm.book,
        chapter: votm.chapter,
        verseStart: votm.verseStart,
        verseEnd: votm.verseEnd,
      } as any)
    : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Home" showBack={false} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.icon} />
        }
      >
        {/* VOTM Section */}
        {votmLoading ? (
          <SkeletonCard isDark={isDark} />
        ) : votm ? (
          <VOTMCard
            votm={votm}
            verseText={verseText}
            textLoading={textLoading}
            masteryCount={masteryCount}
            userMastered={userMastered}
            userHasVerse={userHasVerse}
            version={defaultVersion}
            onPress={handleVOTMPress}
            onAddPress={handleAddPress}
          />
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.emptyText, { color: colors.icon }]}>
              No verse of the month yet.
            </Text>
            <Text style={[styles.emptySubtext, { color: colors.icon }]}>
              Check back soon!
            </Text>
          </View>
        )}

        {/* Insights Section */}
        <InsightsCard ref={insightsCardRef} />
      </ScrollView>

      {/* Expanded Verse Modal */}
      <Modal
        visible={expanded}
        transparent
        animationType="fade"
        onRequestClose={() => setExpanded(false)}
      >
        <BlurView intensity={isDark ? 40 : 80} tint={isDark ? 'dark' : 'light'} style={styles.blurOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={[styles.referenceBadge, { backgroundColor: badgeBg }]}>
                <IconSymbol name="book.fill" size={14} color={accentColor} />
                <Text style={[styles.referenceText, { color: accentColor }]}>
                  {reference}
                </Text>
              </View>
              <Pressable onPress={() => setExpanded(false)} hitSlop={8}>
                <IconSymbol name="xmark.circle.fill" size={28} color={colors.icon} />
              </Pressable>
            </View>

            {/* Full scrollable verse text */}
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalVerseText, { color: colors.text }]}>
                {verseText || 'Unable to load verse text'}
              </Text>
            </ScrollView>
          </View>
        </BlurView>
      </Modal>

      {/* Collection Picker Modal */}
      <Modal
        visible={collectionPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCollectionPickerVisible(false)}
      >
        <BlurView intensity={isDark ? 40 : 80} tint={isDark ? 'dark' : 'light'} style={styles.blurOverlay}>
          <View style={[styles.pickerCard, { backgroundColor: colors.card }]}>
            {/* Header */}
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>
                Add to Collection
              </Text>
              <Pressable onPress={() => setCollectionPickerVisible(false)} hitSlop={8}>
                <IconSymbol name="xmark.circle.fill" size={28} color={colors.icon} />
              </Pressable>
            </View>

            {/* Verse reference */}
            <View style={[styles.referenceBadge, { backgroundColor: badgeBg, marginBottom: 16 }]}>
              <IconSymbol name="book.fill" size={14} color={accentColor} />
              <Text style={[styles.referenceText, { color: accentColor }]}>
                {reference}
              </Text>
            </View>

            {/* Collection list */}
            <ScrollView style={styles.collectionList}>
              {pickableCollections.map((collection) => {
                const isSelected = selectedCollections.includes(collection.id);
                return (
                  <Pressable
                    key={collection.id}
                    style={[
                      styles.collectionItem,
                      { backgroundColor: isSelected ? badgeBg : 'transparent' },
                    ]}
                    onPress={() => toggleCollection(collection.id)}
                  >
                    <View style={styles.collectionInfo}>
                      <IconSymbol
                        name={collection.icon || 'folder.fill'}
                        size={20}
                        color={collection.iconColor || accentColor}
                      />
                      <Text style={[styles.collectionName, { color: colors.text }]}>
                        {collection.name}
                      </Text>
                    </View>
                    <IconSymbol
                      name={isSelected ? 'checkmark.circle.fill' : 'circle'}
                      size={24}
                      color={isSelected ? accentColor : colors.icon}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Add button */}
            <Pressable
              style={[
                styles.addButton,
                {
                  backgroundColor: selectedCollections.length > 0 ? accentColor : colors.icon,
                  opacity: selectedCollections.length > 0 ? 1 : 0.5,
                },
              ]}
              onPress={handleAddToCollections}
              disabled={selectedCollections.length === 0 || adding}
            >
              {adding ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.addButtonText}>
                  Add to {selectedCollections.length} Collection{selectedCollections.length !== 1 ? 's' : ''}
                </Text>
              )}
            </Pressable>
          </View>
        </BlurView>
      </Modal>
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
  content: {
    padding: 16,
    gap: 20,
  },
  // Skeleton loading styles
  skeletonCard: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    minHeight: 180,
  },
  skeletonLine: {
    borderRadius: 6,
  },
  skeletonHeader: {
    width: 140,
    height: 16,
  },
  skeletonBadge: {
    width: 100,
    height: 28,
    borderRadius: 14,
  },
  skeletonText: {
    width: '100%',
    height: 16,
  },
  skeletonTextShort: {
    width: '70%',
    height: 16,
  },
  skeletonFooter: {
    width: 160,
    height: 14,
    marginTop: 4,
  },
  emptyCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '500',
  },
  emptySubtext: {
    fontSize: 14,
  },
  // Modal styles
  blurOverlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 20,
    maxHeight: '80%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  referenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  referenceText: {
    fontSize: 15,
    fontWeight: '600',
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalVerseText: {
    fontSize: 19,
    lineHeight: 30,
  },
  // Collection picker styles
  pickerCard: {
    borderRadius: 20,
    maxHeight: '70%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  pickerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  collectionList: {
    marginBottom: 16,
  },
  collectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 4,
  },
  collectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  collectionName: {
    fontSize: 16,
    fontWeight: '500',
  },
  addButton: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff', // Always white on colored button
    fontSize: 16,
    fontWeight: '600',
  },
});
