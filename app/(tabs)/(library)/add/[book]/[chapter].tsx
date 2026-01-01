import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { normalizeBookName, getVerseCount } from '@/lib/bible';
import { type BibleVersion } from '@/lib/storage';
import { useAppStore } from '@/lib/store';
import { fetchVerse, fetchChapter } from '@/lib/api';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState, useCallback, useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  type LayoutRectangle,
  type GestureResponderEvent,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';

interface VerseLayout {
  verseNum: number;
  top: number;
  bottom: number;
}

export default function VerseSelectScreen() {
  const { book, chapter, collectionId, version } = useLocalSearchParams<{
    book: string;
    chapter: string;
    collectionId?: string;
    version?: string;
  }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const bibleVersion = useAppStore((state) => state.bibleVersion);

  const bookName = normalizeBookName(decodeURIComponent(book ?? ''));
  const chapterNum = parseInt(chapter ?? '1', 10);
  const verseCount = getVerseCount(bookName, chapterNum);

  // Translation from URL param (passed from book selection), fallback to store
  const initialVersion = (version === 'ESV' || version === 'NLT') ? version : bibleVersion;
  const [selectedVersion, setSelectedVersion] = useState<BibleVersion>(initialVersion);
  const [versionPickerVisible, setVersionPickerVisible] = useState(false);

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
  const scrollViewRef = useRef<ScrollView>(null);

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
      }, collectionId || 'my-verses', selectedVersion);

      // Navigate back to collection or library
      if (collectionId) {
        router.navigate(`/(tabs)/(library)/${collectionId}`);
      } else {
        router.navigate('/(tabs)/(library)');
      }
    } catch (error) {
      console.error('Failed to add verses:', error);
      Alert.alert('Error', `Failed to add verses: ${error}`);
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

  const highlightBg = isDark ? 'rgba(96, 165, 250, 0.35)' : 'rgba(10, 126, 164, 0.25)';
  const buttonBg = isDark ? '#3b82f6' : '#0a7ea4';

  const handleVersionSelect = (ver: BibleVersion) => {
    Haptics.selectionAsync();
    setSelectedVersion(ver);
    setVersionPickerVisible(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={`${bookName} ${chapterNum}`}
        rightButton={{
          label: selectedVersion,
          onPress: () => setVersionPickerVisible(true),
          variant: 'text',
        }}
      />

      {/* Version Picker Modal */}
      <Modal
        visible={versionPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setVersionPickerVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setVersionPickerVisible(false)}
        >
          <View style={[styles.pickerContainer, { backgroundColor: isDark ? '#2c2c2e' : '#fff' }]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>Translation</Text>
            {(['ESV', 'NLT'] as BibleVersion[]).map((ver) => (
              <Pressable
                key={ver}
                style={[
                  styles.pickerOption,
                  selectedVersion === ver && { backgroundColor: isDark ? '#0a84ff' : '#007aff' },
                ]}
                onPress={() => handleVersionSelect(ver)}
              >
                <Text
                  style={[
                    styles.pickerOptionText,
                    { color: selectedVersion === ver ? '#fff' : colors.text },
                  ]}
                >
                  {ver}
                </Text>
                <Text
                  style={[
                    styles.pickerOptionSubtext,
                    { color: selectedVersion === ver ? 'rgba(255,255,255,0.7)' : colors.icon },
                  ]}
                >
                  {ver === 'ESV' ? 'English Standard Version' : 'New Living Translation'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

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
          <IconSymbol name="exclamationmark.triangle.fill" size={48} color="#ef4444" />
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
            <View style={styles.versesContainer}>
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
                      <Text style={[styles.verseNumber, { color: isDark ? '#60a5fa' : colors.tint }]}>
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

      {hasSelection && (
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
              <ActivityIndicator color="#fff" />
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContainer: {
    width: '80%',
    maxWidth: 300,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  pickerTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  pickerOption: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  pickerOptionText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pickerOptionSubtext: {
    fontSize: 12,
    marginTop: 2,
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
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
});
