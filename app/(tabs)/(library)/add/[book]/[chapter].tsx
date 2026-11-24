import { AppHeader } from '@/components/app-header';
import { ChapterVerses } from '@/components/library/ChapterVerses';
import { BibleTranslationPicker } from '@/components/ui/BibleTranslationPicker';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWindowClass } from '@/hooks/use-window-class';
import { getVerseCount, normalizeBookName } from '@/lib/bible';
import { type BibleVersion } from '@/lib/storage';
import { useAppStore } from '@/lib/store';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** A chapter on a phone (and the open Duo upright). On a wide window the add screen shows it beside the books instead. */
export default function VerseSelectScreen() {
  const { book, chapter, collectionId } = useLocalSearchParams<{
    book: string;
    chapter: string;
    collectionId?: string;
  }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  // The account translation. The picker below changes it everywhere.
  const selectedVersion = useAppStore((state) => state.bibleVersion);

  const bookName = normalizeBookName(decodeURIComponent(book ?? ''));
  const chapterNum = parseInt(chapter ?? '1', 10);
  const verseCount = getVerseCount(bookName, chapterNum);
  const [versionPickerVisible, setVersionPickerVisible] = useState(false);
  const wide = useWindowClass() === 'wide';

  // On a wide window (an unfold with this page open, or a link) the add screen shows this chapter in its pane.
  useEffect(() => {
    if (!wide) return;
    router.dismissTo({
      pathname: '/(tabs)/(library)/add',
      // `opened` makes each redirect new, so a second one to the same chapter still opens it.
      params: { ...(collectionId ? { collectionId } : {}), book: bookName, chapter: String(chapterNum), opened: String(Date.now()) },
    });
  }, [wide, collectionId, bookName, chapterNum]);

  const handleVersionSelect = (ver: BibleVersion) => {
    Haptics.selectionAsync();
    setVersionPickerVisible(false);
    void useAppStore.getState().setBibleVersion(ver);
  };

  if (wide) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title={`${bookName} ${chapterNum}`}
        rightButton={{
          label: selectedVersion,
          accessibilityLabel: `Translation, ${selectedVersion}`,
          testID: 'verse-translation-picker',
          onPress: () => setVersionPickerVisible(true),
        }}
      />

      <BibleTranslationPicker
        version={selectedVersion}
        visible={versionPickerVisible}
        onSelect={handleVersionSelect}
        onClose={() => setVersionPickerVisible(false)}
        accountNote
      />

      <ChapterVerses bookName={bookName} chapterNum={chapterNum} collectionId={collectionId} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
