import { IconSymbol } from '@/components/ui/icon-symbol';
import { VerseReferenceBadge } from '@/components/ui/VerseReferenceBadge';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Collection, SavedVerse } from '@/lib/storage';
import { useAppStore, useCollections, useVerses } from '@/lib/store';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export function CopyToCollectionModal({
  verse,
  onClose,
  onCopied,
}: {
  verse: SavedVerse;
  onClose: () => void;
  onCopied: (collectionName: string) => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const collections = useCollections();
  const verses = useVerses();
  const memberships = new Set(verses.filter((v) => v.id === verse.id).map((v) => v.collectionId));
  const pending = useRef(false);
  const [copyingTo, setCopyingTo] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const close = () => {
    if (!pending.current) onClose();
  };

  const copy = async (collection: Collection) => {
    if (pending.current) return;
    pending.current = true;
    setCopyingTo(collection.id);
    setFailed(false);
    try {
      await useAppStore.getState().copyVerseToCollection(verse.id, collection.id);
      onCopied(collection.name);
    } catch {
      setFailed(true);
    } finally {
      pending.current = false;
      setCopyingTo(null);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={close} />
        <View style={[styles.card, { backgroundColor: colors.card }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Copy to collection</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.close}>
              <IconSymbol name="xmark" size={18} color={colors.icon} />
            </Pressable>
          </View>
          <View style={styles.reference}>
            <VerseReferenceBadge
              book={verse.book}
              chapter={verse.chapter}
              verseStart={verse.verseStart}
              verseEnd={verse.verseEnd}
              version={verse.version}
            />
          </View>
          <ScrollView style={styles.destinations}>
            {collections.filter((c) => !c.isVirtual).map((collection) => {
              const alreadyAdded = memberships.has(collection.id);
              const disabled = alreadyAdded || copyingTo !== null;
              return (
                <Pressable
                  key={collection.id}
                  accessibilityRole="button"
                  accessibilityLabel={alreadyAdded ? `${collection.name}, Already added` : collection.name}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => void copy(collection)}
                  style={({ pressed }) => [
                    styles.row,
                    { backgroundColor: pressed ? colors.cardAlt : colors.card, borderColor: colors.borderLight },
                  ]}
                >
                  <IconSymbol name={collection.isDefault ? 'heart.fill' : 'folder.fill'} size={18} color={colors.icon} />
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>{collection.name}</Text>
                  {copyingTo === collection.id ? (
                    <ActivityIndicator color={colors.icon} />
                  ) : alreadyAdded ? (
                    <Text style={[styles.status, { color: colors.icon }]}>Already added</Text>
                  ) : (
                    <IconSymbol name="chevron.right" size={14} color={colors.icon} />
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          {failed && (
            <Text style={[styles.error, { color: colors.error }]} accessibilityLiveRegion="polite">
              Could not copy this verse. Please try again.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    padding: 20,
    borderRadius: Radius.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
  },
  close: {
    padding: 12,
    marginRight: -8,
  },
  reference: {
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  destinations: {
    flexGrow: 0,
  },
  row: {
    minHeight: 48,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  status: {
    fontSize: 13,
    flexShrink: 1,
  },
  error: {
    fontSize: 14,
    marginTop: 12,
  },
});
