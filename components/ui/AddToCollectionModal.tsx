import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerseReferenceBadge } from '@/components/ui/VerseReferenceBadge';
import type { VerseData } from '@/components/ui/VerseExpandModal';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppStore, useCollections } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { BlurView } from 'expo-blur';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface AddToCollectionModalProps {
  visible: boolean;
  verse: VerseData | null;
  version: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AddToCollectionModal({
  visible,
  verse,
  version,
  onClose,
  onSuccess,
}: AddToCollectionModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const accentColor = colors.tint;
  const badgeBg = colors.primaryLight;

  const collections = useCollections();
  const addVerse = useAppStore((s) => s.addVerse);

  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  // Filter collections for picker (exclude virtual collections like Mastered)
  const pickableCollections = useMemo(() => {
    return collections.filter((c) => !c.isVirtual);
  }, [collections]);

  // Pre-select default collection when modal opens
  useMemo(() => {
    if (visible) {
      const defaultColl = collections.find((c) => c.isDefault);
      if (defaultColl) {
        setSelectedCollections([defaultColl.id]);
      }
    } else {
      setSelectedCollections([]);
    }
  }, [visible, collections]);

  const toggleCollection = (id: string) => {
    setSelectedCollections((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleAdd = async () => {
    if (!verse || selectedCollections.length === 0) return;

    setAdding(true);
    try {
      for (const collectionId of selectedCollections) {
        await addVerse(
          {
            book: verse.book,
            chapter: verse.chapter,
            verseStart: verse.verseStart,
            verseEnd: verse.verseEnd,
          },
          collectionId,
          version
        );
      }
      onClose();
      onSuccess?.();
    } catch (e) {
      console.error('[AddToCollectionModal] Failed to add verse:', e);
      showErrorToast('Failed to add verse. Please try again.');
    } finally {
      setAdding(false);
    }
  };

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
        <View style={[styles.pickerCard, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.pickerHeader}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>
              Add to Collection
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <IconSymbol name="xmark.circle.fill" size={28} color={colors.icon} />
            </Pressable>
          </View>

          {/* Verse reference with version */}
          <View style={styles.badgeRow}>
            <VerseReferenceBadge
              book={verse.book}
              chapter={verse.chapter}
              verseStart={verse.verseStart}
              verseEnd={verse.verseEnd}
              version={version}
            />
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
            onPress={handleAdd}
            disabled={selectedCollections.length === 0 || adding}
          >
            {adding ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.addButtonText}>
                Add to {selectedCollections.length} Collection
                {selectedCollections.length !== 1 ? 's' : ''}
              </Text>
            )}
          </Pressable>
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
  badgeRow: {
    marginBottom: 16,
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
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
