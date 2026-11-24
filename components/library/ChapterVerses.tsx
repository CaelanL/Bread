// The chapter's verses with the range gesture and Add: the chapter route on a phone, the Bible
// picker's right pane on a wide window. See docs/features/adding-verses.md#browsing-a-chapter.
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius, Shadows, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchChapter } from '@/lib/api';
import { sharedErrorMessage } from '@/lib/shared/invite-code';
import { DEFAULT_COLLECTION_ID } from '@/lib/storage';
import { useAppStore } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import NetInfo from '@react-native-community/netinfo';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutRectangle,
} from 'react-native';

interface VerseLayout {
  verseNum: number;
  top: number;
  bottom: number;
}

export function ChapterVerses({ bookName, chapterNum, collectionId, wide }: {
  bookName: string;
  chapterNum: number;
  collectionId?: string;
  /** The Bible-Picker board's pane: the title in the content, the reference and Add docked low. */
  wide?: boolean;
}) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const selectedVersion = useAppStore((state) => state.bibleVersion);

  // Chapter data from API
  const [verses, setVerses] = useState<[string, string][]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Load chapter from API
  useEffect(() => {
    let cancelled = false;

    async function loadChapter() {
      setLoading(true);
      setError(null);
      setIsOffline(false);

      // Check network status
      const netState = await NetInfo.fetch();
      if (!netState.isConnected) {
        setIsOffline(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetchChapter(bookName, chapterNum, selectedVersion);
        if (cancelled) return;

        // Validate response has verses
        if (!response.verses || typeof response.verses !== 'object') {
          throw new Error('Invalid response from server');
        }

        // Convert verses object to sorted array
        const versesArray = Object.entries(response.verses)
          .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10)) as [string, string][];
        setVerses(versesArray);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load chapter:', err);
        setError(err instanceof Error ? err.message : 'Failed to load chapter');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadChapter();
    return () => { cancelled = true; };
  }, [bookName, chapterNum, selectedVersion, retryCount]);

  const handleRetry = useCallback(() => {
    // Clear states immediately for visual feedback
    setError(null);
    setIsOffline(false);
    setLoading(true);
    // Trigger re-fetch
    setRetryCount(c => c + 1);
  }, []);

  // Selection state
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Layout tracking
  const verseLayouts = useRef<VerseLayout[]>([]);
  const scrollOffset = useRef(0);
  const scrollViewPageY = useRef(0);
  const scrollViewRef = useRef<ScrollViewInstance>(null);

  // Long press timer
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  // Auto-scroll during drag selection
  const scrollViewHeight = useRef(0);
  const autoScrollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasSelection = selectionStart !== null && selectionEnd !== null;

  const isVerseSelected = (verseNum: number) => {
    if (!hasSelection) return false;
    const min = Math.min(selectionStart!, selectionEnd!);
    const max = Math.max(selectionStart!, selectionEnd!);
    return verseNum >= min && verseNum <= max;
  };

  const getVerseAtY = useCallback((pageY: number): number | null => {
    const relativeY = pageY - scrollViewPageY.current + scrollOffset.current - 16;

    for (const layout of verseLayouts.current) {
      if (relativeY >= layout.top && relativeY <= layout.bottom) {
        return layout.verseNum;
      }
    }

    if (verseLayouts.current.length > 0 && relativeY < verseLayouts.current[0].top) {
      return verseLayouts.current[0].verseNum;
    }

    if (verseLayouts.current.length > 0) {
      const last = verseLayouts.current[verseLayouts.current.length - 1];
      if (relativeY > last.bottom) {
        return last.verseNum;
      }
    }

    return null;
  }, []);

  const handleVerseLayout = (verseNum: number, layout: LayoutRectangle) => {
    verseLayouts.current = verseLayouts.current.filter(v => v.verseNum !== verseNum);
    verseLayouts.current.push({
      verseNum,
      top: layout.y,
      bottom: layout.y + layout.height,
    });
    verseLayouts.current.sort((a, b) => a.verseNum - b.verseNum);
  };

  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  };

  const handleScrollViewLayout = (e: any) => {
    scrollViewHeight.current = e.nativeEvent.layout.height;
    if (scrollViewRef.current) {
      (scrollViewRef.current as any).measure?.(
        (_x: number, _y: number, _width: number, _height: number, _pageX: number, pageY: number) => {
          scrollViewPageY.current = pageY;
        }
      );
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const clearAutoScroll = () => {
    if (autoScrollInterval.current) {
      clearInterval(autoScrollInterval.current);
      autoScrollInterval.current = null;
    }
  };

  // ScrollView touch handlers for initial detection
  const handleScrollViewTouchStart = (e: any) => {
    const pageY = e.nativeEvent.pageY;
    touchStartY.current = pageY;
    touchStartTime.current = Date.now();

    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      const verse = getVerseAtY(pageY);
      if (verse !== null) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setIsSelecting(true);
        setSelectionStart(verse);
        setSelectionEnd(verse);
      }
    }, 250);
  };

  const handleScrollViewTouchMove = (e: any) => {
    const pageY = e.nativeEvent.pageY;
    // Cancel long-press if user scrolls
    if (!isSelecting && Math.abs(pageY - touchStartY.current) > 10) {
      clearLongPressTimer();
    }
  };

  const handleScrollViewTouchEnd = (e: any) => {
    const pageY = e.nativeEvent.pageY;
    const touchDuration = Date.now() - touchStartTime.current;
    const touchDistance = Math.abs(pageY - touchStartY.current);

    clearLongPressTimer();

    // Quick tap = select/deselect (only if not in selection mode)
    if (touchDuration < 250 && touchDistance < 10 && !isSelecting) {
      if (hasSelection) {
        setSelectionStart(null);
        setSelectionEnd(null);
      } else {
        const verse = getVerseAtY(pageY);
        if (verse !== null) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectionStart(verse);
          setSelectionEnd(verse);
        }
      }
    }

    setIsSelecting(false);
  };

  // Outer View responder handlers - only active when selecting
  const handleResponderMove = (e: GestureResponderEvent) => {
    if (!isSelecting) return;

    const pageY = e.nativeEvent.pageY;
    const relativeY = pageY - scrollViewPageY.current;

    // Update selection
    const verse = getVerseAtY(pageY);
    if (verse !== null && verse !== selectionEnd) {
      Haptics.selectionAsync();
      setSelectionEnd(verse);
    }

    // Auto-scroll when near edges (within 60px)
    const EDGE_THRESHOLD = 60;
    const SCROLL_SPEED = 8;

    clearAutoScroll();

    if (relativeY < EDGE_THRESHOLD) {
      // Near top - scroll up
      autoScrollInterval.current = setInterval(() => {
        const newOffset = Math.max(0, scrollOffset.current - SCROLL_SPEED);
        scrollViewRef.current?.scrollTo({ y: newOffset, animated: false });
      }, 16);
    } else if (relativeY > scrollViewHeight.current - EDGE_THRESHOLD) {
      // Near bottom - scroll down
      autoScrollInterval.current = setInterval(() => {
        scrollViewRef.current?.scrollTo({
          y: scrollOffset.current + SCROLL_SPEED,
          animated: false,
        });
      }, 16);
    }
  };

  const handleAddVerses = async () => {
    if (!hasSelection || isSaving) return;

    const min = Math.min(selectionStart!, selectionEnd!);
    const max = Math.max(selectionStart!, selectionEnd!);

    setIsSaving(true);

    try {
      await useAppStore.getState().addVerse({
        book: bookName,
        chapter: chapterNum,
        verseStart: min,
        verseEnd: max,
      }, collectionId || DEFAULT_COLLECTION_ID);

      // Navigate back to collection or library
      if (collectionId) {
        router.navigate(`/(tabs)/(library)/${collectionId}`);
      } else {
        router.navigate('/(tabs)/(library)');
      }
    } catch (error) {
      console.error('Failed to add verses:', error);
      showErrorToast(sharedErrorMessage(error, 'Failed to add verse. Please try again.'));
    } finally {
      setIsSaving(false);
    }
  };

  const min = hasSelection ? Math.min(selectionStart!, selectionEnd!) : null;
  const max = hasSelection ? Math.max(selectionStart!, selectionEnd!) : null;

  const buttonText = min !== null && max !== null
    ? min === max
      ? `Add Verse ${min}`
      : `Add Verses ${min}-${max}`
    : '';

  const highlightBg = isDark ? 'rgba(96, 165, 250, 0.35)' : 'rgba(10, 126, 164, 0.25)'; // Keep for highlight selection
  const buttonBg = colors.primary;

  return (
    <View style={styles.container}>
      {/* Loading State */}
      {loading && (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={buttonBg} />
          <Text style={[styles.statusText, { color: colors.icon }]}>Loading chapter...</Text>
        </View>
      )}

      {/* Offline State */}
      {!loading && isOffline && (
        <View style={styles.centerContainer}>
          <IconSymbol name="wifi.slash" size={48} color={colors.icon} />
          <Text style={[styles.statusTitle, { color: colors.text }]}>No Internet Connection</Text>
          <Text style={[styles.statusText, { color: colors.icon }]}>
            Connect to the internet to browse verses
          </Text>
          <Pressable
            style={[styles.retryButton, { backgroundColor: buttonBg }]}
            onPress={handleRetry}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      )}

      {/* Error State */}
      {!loading && !isOffline && error && (
        <View style={styles.centerContainer}>
          <IconSymbol name="exclamationmark.triangle.fill" size={48} color={colors.error} />
          <Text style={[styles.statusTitle, { color: colors.text }]}>Failed to Load</Text>
          <Text style={[styles.statusText, { color: colors.icon }]}>{error}</Text>
          <Pressable
            style={[styles.retryButton, { backgroundColor: buttonBg }]}
            onPress={handleRetry}
          >
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      )}

      {/* Verses Content */}
      {!loading && !isOffline && !error && (
        <View
          style={styles.touchContainer}
          onStartShouldSetResponder={() => false}
          onMoveShouldSetResponder={() => false}
          onStartShouldSetResponderCapture={() => isSelecting}
          onMoveShouldSetResponderCapture={() => isSelecting}
          onResponderMove={handleResponderMove}
          onResponderRelease={() => {
            clearAutoScroll();
            setIsSelecting(false);
          }}
          onResponderTerminate={() => {
            clearAutoScroll();
            setIsSelecting(false);
          }}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            onScroll={handleScroll}
            onLayout={handleScrollViewLayout}
            scrollEventThrottle={16}
            scrollEnabled={!isSelecting}
            onTouchStart={handleScrollViewTouchStart}
            onTouchMove={handleScrollViewTouchMove}
            onTouchEnd={handleScrollViewTouchEnd}
          >
            <View style={[styles.versesContainer, wide && styles.wideVerses]}>
              {wide && <Text accessibilityRole="header" style={[styles.wideTitle, { color: colors.text }]}>{bookName} {chapterNum}</Text>}
              <Text style={[styles.hintText, wide && styles.wideHint, { color: colors.icon }]}>
                Tap to select, or hold and drag to select multiple
              </Text>
              {verses.map(([verseNum, text]) => {
                const num = parseInt(verseNum, 10);
                const selected = isVerseSelected(num);

                return (
                  <View
                    key={verseNum}
                    onLayout={(e) => handleVerseLayout(num, e.nativeEvent.layout)}
                    style={[
                      styles.verseWrapper,
                      selected && { backgroundColor: highlightBg },
                    ]}
                  >
                    <Text style={[styles.verseText, { color: colors.text }]}>
                      <Text style={[styles.verseNumber, { color: colors.tint }]}>
                        {verseNum}
                      </Text>
                      {'  '}
                      {text}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={styles.bottomPadding} />
          </ScrollView>
        </View>
      )}

      {hasSelection && wide && (
        <View style={styles.wideBar}>
          <LinearGradient pointerEvents="none" colors={[withAlpha(colors.background, 0), colors.background]} style={styles.wideFade} />
          <View style={styles.wideSummary}>
            <Text style={[styles.wideReference, { color: colors.text }]}>
              {bookName} {chapterNum}:{min === max ? min : `${min}-${max}`}
            </Text>
            <Text style={[styles.wideNote, { color: colors.icon }]}>{selectedVersion} · Tap a verse to clear</Text>
          </View>
          <Pressable
            style={[styles.wideAddButton, { backgroundColor: buttonBg, opacity: isSaving ? 0.7 : 1 }]}
            onPress={handleAddVerses}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.wideAddText}>{buttonText}</Text>
            )}
          </Pressable>
        </View>
      )}

      {hasSelection && !wide && (
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: colors.background, borderTopColor: colors.icon + '30' },
          ]}
        >
          <Pressable
            style={[styles.addButton, { backgroundColor: buttonBg, opacity: isSaving ? 0.7 : 1 }]}
            onPress={handleAddVerses}
            disabled={isSaving}
          >
            {isSaving ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.addButtonText}>{buttonText}</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginTop: 8,
  },
  statusText: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 4,
  },
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 16,
  },
  retryButtonText: {
    color: '#fff', // Always white on colored button
    fontSize: 16,
    fontWeight: '600',
  },
  touchContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  versesContainer: {
    padding: 16,
  },
  hintText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 6,
  },
  verseWrapper: {
    borderRadius: 4,
    marginVertical: 1,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  verseText: {
    fontSize: 18,
    lineHeight: 28,
  },
  verseNumber: {
    fontSize: 12,
    fontWeight: '700',
  },
  bottomPadding: {
    height: 120,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 40,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addButton: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff', // Always white on colored button
    fontSize: 17,
    fontWeight: '600',
  },
  wideVerses: {
    maxWidth: 498 + 56,
    width: '100%',
    alignSelf: 'center',
    paddingTop: 26,
    paddingHorizontal: 28,
  },
  wideTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  wideHint: {
    marginTop: 14,
    marginBottom: 8,
  },
  wideBar: {
    position: 'absolute',
    left: 28,
    right: 20,
    bottom: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  wideFade: {
    position: 'absolute',
    left: -28,
    right: -20,
    bottom: -22,
    height: 120,
  },
  wideSummary: {
    flex: 1,
    gap: 2,
  },
  wideReference: {
    fontSize: 16,
    fontWeight: '600',
  },
  wideNote: {
    fontSize: 13,
  },
  wideAddButton: {
    height: 56,
    paddingHorizontal: 28,
    borderRadius: Radius.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: Shadows.action,
  },
  wideAddText: {
    color: '#fff', // Always white on colored button
    fontSize: 19,
    fontWeight: '700',
  },
});
