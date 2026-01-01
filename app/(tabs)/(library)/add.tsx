import { AppHeader } from '@/components/app-header';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BIBLE_BOOKS, OLD_TESTAMENT_END } from '@/lib/bible/books';
import { getChapterCount } from '@/lib/bible';
import { type BibleVersion } from '@/lib/storage';
import { useAppStore } from '@/lib/store';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export default function AddVerseScreen() {
  const { collectionId } = useLocalSearchParams<{ collectionId?: string }>();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const bibleVersion = useAppStore((state) => state.bibleVersion);

  const [expandedBook, setExpandedBook] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<BibleVersion>(bibleVersion);
  const [versionPickerVisible, setVersionPickerVisible] = useState(false);

  const handleBookPress = (book: string) => {
    setExpandedBook(expandedBook === book ? null : book);
  };

  const handleChapterPress = (book: string, chapter: number) => {
    const params = new URLSearchParams();
    if (collectionId) params.set('collectionId', collectionId);
    params.set('version', selectedVersion);
    const queryString = params.toString();
    router.push(`/(tabs)/(library)/add/${encodeURIComponent(book)}/${chapter}?${queryString}`);
  };

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
            <Text style={[styles.testamentLabel, { color: colors.icon }]}>New Testament</Text>
          </View>
        )}
        {index === 0 && (
          <View style={[styles.testamentDivider, { borderBottomColor: colors.icon }]}>
            <Text style={[styles.testamentLabel, { color: colors.icon }]}>Old Testament</Text>
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

  const handleVersionSelect = (version: BibleVersion) => {
    Haptics.selectionAsync();
    setSelectedVersion(version);
    setVersionPickerVisible(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <AppHeader
        title="Add Verse"
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
            {(['ESV', 'NLT'] as BibleVersion[]).map((version) => (
              <Pressable
                key={version}
                style={[
                  styles.pickerOption,
                  selectedVersion === version && { backgroundColor: isDark ? '#0a84ff' : '#007aff' },
                ]}
                onPress={() => handleVersionSelect(version)}
              >
                <Text
                  style={[
                    styles.pickerOptionText,
                    { color: selectedVersion === version ? '#fff' : colors.text },
                  ]}
                >
                  {version}
                </Text>
                <Text
                  style={[
                    styles.pickerOptionSubtext,
                    { color: selectedVersion === version ? 'rgba(255,255,255,0.7)' : colors.icon },
                  ]}
                >
                  {version === 'ESV' ? 'English Standard Version' : 'New Living Translation'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <ScrollView style={styles.scrollView}>
        {BIBLE_BOOKS.map((book, index) => renderBook(book, index))}
        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
  scrollView: {
    flex: 1,
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
