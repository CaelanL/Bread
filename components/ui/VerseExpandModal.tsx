import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerseReferenceBadge } from '@/components/ui/VerseReferenceBadge';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BlurView } from 'expo-blur';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export interface VerseData {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}

interface VerseExpandModalProps {
  visible: boolean;
  verse: VerseData | null;
  verseText: string | null;
  version: string;
  showAddButton?: boolean;
  onClose: () => void;
  onAddPress?: () => void;
}

export function VerseExpandModal({
  visible,
  verse,
  verseText,
  version,
  showAddButton = false,
  onClose,
  onAddPress,
}: VerseExpandModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  if (!verse) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <BlurView
        intensity={isDark ? 40 : 80}
        tint={isDark ? 'dark' : 'light'}
        style={styles.blurOverlay}
      >
        <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <VerseReferenceBadge
              book={verse.book}
              chapter={verse.chapter}
              verseStart={verse.verseStart}
              verseEnd={verse.verseEnd}
              version={version}
              showAddButton={showAddButton}
              onAddPress={onAddPress}
            />
            <Pressable onPress={onClose} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.icon} />
            </Pressable>
          </View>

          {/* Verse text */}
          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            {verseText === null ? (
              <ActivityIndicator size="small" color={colors.icon} style={styles.loader} />
            ) : (
              <Text style={[styles.modalVerseText, { color: colors.text }]}>
                {verseText || 'Unable to load verse text'}
              </Text>
            )}
          </ScrollView>
        </View>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  modalScroll: {
    flexGrow: 0,
  },
  modalVerseText: {
    fontSize: 19,
    lineHeight: 30,
  },
  loader: {
    marginVertical: 20,
  },
});
