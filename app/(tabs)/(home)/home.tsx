import { useIsFocused } from 'expo-router/react-navigation';
import { useAuth } from '@/lib/auth';
import type { VOTM } from '@/lib/api/votm';
import { LargeTitle, TopBar, useTopBarHeight } from '@/components/ui/TopBar';
import { ExploreCollections } from '@/components/home/ExploreCollections';
import { InsightsCard, type InsightsCardRef } from '@/components/home/InsightsCard';
import { IntroVideo } from '@/components/home/IntroVideo';
import { VOTMCard } from '@/components/home/VOTMCard';
import { AddToCollectionModal } from '@/components/ui/AddToCollectionModal';
import { VerseExpandModal } from '@/components/ui/VerseExpandModal';
import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useVotm } from '@/hooks/use-votm';
import { useWindowClass } from '@/hooks/use-window-class';
import { perfMark } from '@/lib/api/dev-timing';
import { useAppStore, useHydrated, useVerses } from '@/lib/store';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function SkeletonCard({ isDark, big }: { isDark: boolean; big: boolean }) {
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
    <View style={[styles.skeletonCard, big && styles.fill, { backgroundColor: bgColor }]}>
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
  const insets = useSafeAreaInsets();
  // Phones keep today's Home. The iPhone Duo follows the Main (wide), Home-Portrait (tall) and Home-Outer boards.
  const windowClass = useWindowClass();
  const big = windowClass === 'wide' || windowClass === 'tall';
  // Upright, the status bar only fills the top right corner, so the title sits under the inset.
  const top = windowClass === 'phone' ? barHeight : windowClass === 'tall' ? TALL_TOP : insets.top + RAIL_TOP;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // Get user's default Bible version from store
  const defaultVersion = useAppStore((state) => state.bibleVersion);

  // Store data
  const verses = useVerses();

  const { votm, loading: votmLoading, text: verseText, textLoading, masteryCount, userMastered, error: monthlyError, refresh: refreshVotm } = useVotm(defaultVersion);
  const hydrated = useHydrated();
  useEffect(() => {
    if (hydrated && verseText) perfMark('home');
  }, [hydrated, verseText]);

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
        contentContainerStyle={[styles.content, contentLayout[windowClass], { paddingTop: top }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.tint} progressViewOffset={top} />
        }
      >
        <LargeTitle root title="Home" />
        <View style={windowClass === 'wide' ? styles.wideRow : windowClass === 'phone' ? styles.phoneStack : styles.stack}>
          <View style={[windowClass === 'wide' && styles.votm, windowClass === 'tall' && styles.tallVotm]}>
            {/* VOTM Section */}
            {votmLoading ? (
              <SkeletonCard isDark={isDark} big={big} />
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
              <View style={[styles.emptyCard, big && styles.fill, { backgroundColor: colors.cardAlt }]}>
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
          </View>

          {/* Insights Section */}
          <View style={windowClass === 'wide' && styles.wideSide}>
            <InsightsCard ref={insightsCardRef} />
          </View>
        </View>
        <ExploreCollections />
        <IntroVideo blocked={expanded || collectionPickerVisible || modalTransition || expandedPresented || pickerPresented} />
      </Reanimated.ScrollView>
      <TopBar />

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

// Board numbers: the title's distance from the top beside the rail, and upright.
const RAIL_TOP = 26;
const TALL_TOP = 54;

const contentLayout = StyleSheet.create({
  phone: {},
  wide: { paddingLeft: 28, paddingRight: 24, gap: 16 },
  outer: { paddingLeft: 18, paddingRight: 10, gap: 16 },
  tall: { paddingHorizontal: 24, gap: 16 },
});

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  wideRow: { flexDirection: 'row', gap: 16, minHeight: 316 },
  wideSide: { width: 330 },
  phoneStack: { gap: 20 },
  stack: { gap: 16 },
  votm: { flex: 1 },
  tallVotm: { minHeight: 262 },
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
