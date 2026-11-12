import { useIsFocused } from '@react-navigation/native';
import { useAuth } from '@/lib/auth';
import type { VOTM } from '@/lib/api/votm';
import { LargeTitle, TopBar, useScrollY, useTopBarHeight } from '@/components/ui/TopBar';
import { ExploreCollections } from '@/components/home/ExploreCollections';
import { InsightsCard, type InsightsCardRef } from '@/components/home/InsightsCard';
import { IntroVideo } from '@/components/home/IntroVideo';
import { VOTMCard } from '@/components/home/VOTMCard';
import { AddToCollectionModal } from '@/components/ui/AddToCollectionModal';
import { VerseExpandModal } from '@/components/ui/VerseExpandModal';
import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useVotm } from '@/hooks/use-votm';
import { useAppStore, useVerses } from '@/lib/store';
import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Reanimated from 'react-native-reanimated';

function SkeletonCard({ isDark }: { isDark: boolean }) {
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
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
  const barHeight = useTopBarHeight();
  const { scrollY, onScroll } = useScrollY();
  const [titleBottom, setTitleBottom] = useState(0);
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Get user's default Bible version from store
  const defaultVersion = useAppStore((state) => state.bibleVersion);

  // Store data
  const verses = useVerses();

  const { votm, loading: votmLoading, text: verseText, textLoading, masteryCount, userMastered, error: monthlyError, refresh: refreshVotm } = useVotm(defaultVersion);

  // Modal states
  const [expanded, setExpanded] = useState(false);
  const [collectionPickerVisible, setCollectionPickerVisible] = useState(false);
  const [modalTransition, setModalTransition] = useState(false);
  const [expandedPresented, setExpandedPresented] = useState(false);
  const [pickerPresented, setPickerPresented] = useState(false);
  const [modalContent, setModalContent] = useState<{ verse: VOTM; text: string | null; version: typeof defaultVersion } | null>(null);
  const focused = useIsFocused();
  const { user } = useAuth();
  const pickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pickerTimer.current) clearTimeout(pickerTimer.current); }, []);

  useEffect(() => {
    if (pickerTimer.current) clearTimeout(pickerTimer.current);
    setExpanded(false); setCollectionPickerVisible(false); setModalTransition(false);
    setExpandedPresented(false); setPickerPresented(false); setModalContent(null);
  }, [focused, user?.id]);
  useEffect(() => {
    if (!votm) return;
    setModalContent((current) => current && current.verse.id === votm.id && current.version === defaultVersion
      ? { ...current, text: verseText } : current);
  }, [votm, verseText, defaultVersion]);

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

  // Pull to refresh handler
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refreshVotm(),
      refresh(), // Refresh store data (collections, verses, mastered)
      insightsCardRef.current?.refresh(), // Refresh streak
    ]);
    setRefreshing(false);
  };

  const handleVOTMPress = () => {
    if (!votm) return;
    setModalContent({ verse: votm, text: verseText, version: defaultVersion });
    setExpandedPresented(process.env.EXPO_OS === 'ios');
    setExpanded(true);
  };

  const handleAddPress = () => {
    if (!votm) return;
    setModalContent({ verse: votm, text: verseText, version: defaultVersion });
    setPickerPresented(process.env.EXPO_OS === 'ios');
    setCollectionPickerVisible(true);
  };

  const handleAddFromExpand = () => {
    setModalTransition(true);
    setExpanded(false);
    pickerTimer.current = setTimeout(() => {
      setPickerPresented(process.env.EXPO_OS === 'ios');
      setCollectionPickerVisible(true);
      setModalTransition(false);
    }, Motion.exitMs);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Reanimated.ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.content, { paddingTop: barHeight }]}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={barHeight} />
        }
      >
        <LargeTitle root title="Home" onBottom={setTitleBottom} />
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
            onRetry={() => void refreshVotm()}
          />
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.cardAlt }]}>
            <Text style={[styles.emptyText, { color: colors.icon }]}>
              {monthlyError ?? 'No verse of the month yet.'}
            </Text>
            {monthlyError ? (
              <Pressable accessibilityRole="button" onPress={() => void refreshVotm()}>
                <Text style={[styles.emptySubtext, { color: colors.primary }]}>Try again</Text>
              </Pressable>
            ) : (
              <Text style={[styles.emptySubtext, { color: colors.icon }]}>Check back soon!</Text>
            )}
          </View>
        )}

        {/* Insights Section */}
        <InsightsCard ref={insightsCardRef} />
        <ExploreCollections />
        <IntroVideo blocked={expanded || collectionPickerVisible || modalTransition || expandedPresented || pickerPresented} />
      </Reanimated.ScrollView>
      <TopBar scrollY={scrollY} title="Home" titleAt={titleBottom} />

      {/* Expanded Verse Modal */}
      <VerseExpandModal
        visible={expanded}
        verse={modalContent?.verse ?? null}
        verseText={modalContent?.text ?? null}
        version={modalContent?.version ?? defaultVersion}
        showAddButton={!userHasVerse}
        onClose={() => setExpanded(false)}
        onDismiss={() => setExpandedPresented(false)}
        onAddPress={handleAddFromExpand}
      />

      {/* Collection Picker Modal */}
      <AddToCollectionModal
        visible={collectionPickerVisible}
        verse={modalContent?.verse ?? null}
        version={modalContent?.version ?? defaultVersion}
        onClose={() => setCollectionPickerVisible(false)}
        onDismiss={() => setPickerPresented(false)}
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
    // eslint-disable-next-line no-restricted-syntax -- existing value, predates the tokens
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
