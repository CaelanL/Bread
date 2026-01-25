import { AppHeader } from '@/components/app-header';
import { InsightsCard, type InsightsCardRef } from '@/components/home/InsightsCard';
import { VOTMCard } from '@/components/home/VOTMCard';
import { AddToCollectionModal } from '@/components/ui/AddToCollectionModal';
import { VerseExpandModal } from '@/components/ui/VerseExpandModal';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getCurrentVOTM, getVOTMMasteryCount, hasUserMasteredVOTM, type VOTM } from '@/lib/api/votm';
import { getVerseText } from '@/lib/api/bible';
import { useAppStore, useVerses } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Animated,
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
  const verses = useVerses();

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
          const { text } = await getVerseText({
            book: currentVotm.book,
            chapter: currentVotm.chapter,
            verseStart: currentVotm.verseStart,
            verseEnd: currentVotm.verseEnd,
            version: defaultVersion,
          } as any);
          setVerseText(text);
        } catch (e) {
          console.error('[HOME] Failed to fetch verse text:', e);
          showErrorToast('Failed to load verse of the month.');
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
    setCollectionPickerVisible(true);
  };

  const handleAddFromExpand = () => {
    setExpanded(false);
    // Small delay to let expand modal close first
    setTimeout(() => setCollectionPickerVisible(true), 150);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader title="Home" showBack={false} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} />
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
      <VerseExpandModal
        visible={expanded}
        verse={votm}
        verseText={verseText}
        version={defaultVersion}
        showAddButton={!userHasVerse}
        onClose={() => setExpanded(false)}
        onAddPress={handleAddFromExpand}
      />

      {/* Collection Picker Modal */}
      <AddToCollectionModal
        visible={collectionPickerVisible}
        verse={votm}
        version={defaultVersion}
        onClose={() => setCollectionPickerVisible(false)}
      />
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
});
