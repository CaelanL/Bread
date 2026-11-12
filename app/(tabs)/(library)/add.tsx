import { HeaderPill } from '@/components/library/CollectionHeader';
import { QuickAddField } from '@/components/library/QuickAddField';
import { BibleTranslationPicker } from '@/components/ui/BibleTranslationPicker';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TopBarButton } from '@/components/ui/TopBar';
import { Colors, Motion } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDebouncedPress } from '@/hooks/use-debounced-press';
import { BIBLE_BOOKS, OLD_TESTAMENT_END } from '@/lib/bible/books';
import { getChapterCount } from '@/lib/bible';
import { type BibleVersion } from '@/lib/storage';
import { useAppStore, useCollection } from '@/lib/store';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const easing = Easing.bezier(...Motion.easing);
// The field's top padding inside QuickAddField, and its gap under the status bar while searching.
const FIELD_INSET = 8;
const SEARCH_TOP = 6;

export default function AddVerseScreen() {
  const { collectionId } = useLocalSearchParams<{ collectionId?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const bibleVersion = useAppStore((state) => state.bibleVersion);

  const [expandedBook, setExpandedBook] = useState<string | null>(null);
  const [versionPickerVisible, setVersionPickerVisible] = useState(false);
  const [searching, setSearching] = useState(false);
  const collection = useCollection(collectionId ?? 'my-verses');
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // Search lifts the field to the top: the bar and title slide up and fade, and the column grows
  // by the same distance so the suggestions still reach the bottom.
  const [lift, setLift] = useState(0);
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(searching ? 1 : 0, { duration: searching ? Motion.expandMs : Motion.exitMs, easing });
  }, [searching, progress]);
  const column = useAnimatedStyle(() => (reduced ? {} : {
    transform: [{ translateY: -progress.value * lift }],
    marginBottom: -progress.value * lift,
  }));
  const chrome = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  // Ignores only a quick re-tap of the same book; a tap on another book goes through.
  const lastBookPress = useRef({ book: '', at: 0 });
  const handleBookPress = (book: string) => {
    const now = Date.now();
    if (lastBookPress.current.book === book && now - lastBookPress.current.at <= 500) return;
    lastBookPress.current = { book, at: now };
    setExpandedBook((current) => (current === book ? null : book));
  };

  const handleChapterPress = useDebouncedPress((book: string, chapter: number) => {
    const params = new URLSearchParams();
    if (collectionId) params.set('collectionId', collectionId);
    const queryString = params.toString();
    router.push(`/(tabs)/(library)/add/${encodeURIComponent(book)}/${chapter}?${queryString}`);
  });

  const renderChapterGrid = (book: string) => {
    const chapterCount = getChapterCount(book);
    const chapters = Array.from({ length: chapterCount }, (_, i) => i + 1);

    return (
      <View style={styles.chapterGrid}>
        {chapters.map((chapter) => (
          <Pressable
            key={chapter}
            style={[styles.chapterButton, { backgroundColor: colors.background }]}
            onPress={() => handleChapterPress(book, chapter)}
          >
            <Text style={[styles.chapterText, { color: colors.text }]}>{chapter}</Text>
          </Pressable>
        ))}
      </View>
    );
  };

  const renderBook = (book: string, index: number) => {
    const isExpanded = expandedBook === book;
    const isNewTestament = index === OLD_TESTAMENT_END + 1;

    return (
      <View key={book}>
        {isNewTestament && (
          <View style={[styles.testamentDivider, { borderBottomColor: colors.icon }]}>
            <Text style={[styles.testamentLabel, { color: colors.primary }]}>New Testament</Text>
          </View>
        )}
        {index === 0 && (
          <View style={[styles.testamentDivider, { borderBottomColor: colors.icon }]}>
            <Text style={[styles.testamentLabel, { color: colors.primary }]}>Old Testament</Text>
          </View>
        )}
        <Pressable
          style={[styles.bookRow, { borderBottomColor: colors.icon + '30' }]}
          onPress={() => handleBookPress(book)}
        >
          <Text style={[styles.bookName, { color: colors.text }]}>{book}</Text>
          <IconSymbol
            name={isExpanded ? 'chevron.down' : 'chevron.right'}
            size={18}
            color={colors.icon}
          />
        </Pressable>
        {isExpanded && renderChapterGrid(book)}
      </View>
    );
  };

  // The picker is the account translation: changing it here changes it everywhere.
  const handleVersionSelect = (version: BibleVersion) => {
    Haptics.selectionAsync();
    setVersionPickerVisible(false);
    void useAppStore.getState().setBibleVersion(version);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Animated.View style={[styles.container, column]}>
        <Animated.View style={[{ paddingTop: insets.top }, chrome]} pointerEvents={searching ? 'none' : 'auto'}>
          <View style={styles.bar}>
            <TopBarButton icon="chevron.left" label="Back" onPress={() => router.back()} />
            <HeaderPill
              testID="add-translation-picker"
              icon="book.closed"
              label={bibleVersion}
              accessibilityLabel={`Translation, ${bibleVersion}`}
              onPress={() => setVersionPickerVisible(true)}
            />
          </View>
          <View style={styles.titleBlock}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Add verses</Text>
            {collection && (
              <Text style={[styles.subtitle, { color: colors.icon }]} numberOfLines={1}>to {collection.name}</Text>
            )}
          </View>
        </Animated.View>

        <View
          style={searching ? styles.container : undefined}
          onLayout={(event) => setLift(event.nativeEvent.layout.y + FIELD_INSET - insets.top - SEARCH_TOP)}
        >
          <QuickAddField collectionId={collectionId} searching={searching} onSearchChange={setSearching} />
        </View>

        {!searching && (
          <Animated.View entering={FadeIn.duration(Motion.expandMs)} exiting={FadeOut.duration(Motion.exitMs)} style={styles.scrollView}>
            <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              {BIBLE_BOOKS.map((book, index) => renderBook(book, index))}
              <View style={styles.bottomPadding} />
            </ScrollView>
          </Animated.View>
        )}
      </Animated.View>

      <BibleTranslationPicker
        version={bibleVersion}
        visible={versionPickerVisible}
        onSelect={handleVersionSelect}
        onClose={() => setVersionPickerVisible(false)}
        accountNote
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
  bar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 6,
    paddingRight: 16,
  },
  titleBlock: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
    gap: 2,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  testamentDivider: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  testamentLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bookName: {
    fontSize: 17,
  },
  chapterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 8,
  },
  chapterButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  chapterText: {
    fontSize: 16,
    fontWeight: '500',
  },
  bottomPadding: {
    height: 40,
  },
});
