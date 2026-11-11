import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { BIBLE_VERSIONS, type BibleVersion } from '@/lib/settings';

const ACCOUNT_NOTE_SEEN_KEY = 'translation_account_note_seen';

// True for the first opening on this device. The flag is read on every opening, since
// the book and chapter screens each mount a picker.
function useFirstOpen(visible: boolean, enabled: boolean): boolean {
  const [first, setFirst] = useState(false);

  useEffect(() => {
    if (!enabled || !visible) return;
    let open = true;
    AsyncStorage.getItem(ACCOUNT_NOTE_SEEN_KEY).then((seen) => {
      if (!open || seen !== null) return;
      setFirst(true);
      AsyncStorage.setItem(ACCOUNT_NOTE_SEEN_KEY, '1').catch(() => {});
    }).catch(() => {});
    return () => {
      open = false;
      setFirst(false);
    };
  }, [visible, enabled]);

  return first;
}

/** `accountNote`: the first time it opens, say that picking changes the account translation. */
export function BibleTranslationPicker({ version, visible, onSelect, onClose, accountNote = false }: {
  version: BibleVersion;
  visible: boolean;
  onSelect: (version: BibleVersion) => void;
  onClose: () => void;
  accountNote?: boolean;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const showNote = useFirstOpen(visible, accountNote);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[styles.container, { backgroundColor: colors.card, shadowColor: colors.shadow }]}
        >
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            Translation
          </Text>
          {showNote && (
            <Text testID="translation-account-note" style={[styles.note, { color: colors.icon }]}>
              Changes your translation everywhere.
            </Text>
          )}
          <ScrollView style={styles.list}>
            {BIBLE_VERSIONS.map(({ value, label, full }) => {
              const selected = value === version;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`${label}, ${full}`}
                  accessibilityState={{ selected }}
                  testID={`bible-translation-${value}`}
                  style={[styles.option, selected && { backgroundColor: colors.primary }]}
                  onPress={() => onSelect(value)}
                >
                  <Text style={[styles.label, { color: selected ? colors.white : colors.text }]}>{label}</Text>
                  <Text style={[styles.fullName, {
                    color: selected ? colors.white : colors.icon,
                    opacity: selected ? 0.7 : 1,
                  }]}>{full}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '80%',
    maxWidth: 300,
    maxHeight: '80%',
    borderRadius: Radius.xl,
    padding: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: { fontSize: 17, fontWeight: '600', marginBottom: 12, textAlign: 'center' },
  note: { fontSize: 13, marginTop: -6, marginBottom: 12, textAlign: 'center' },
  list: { flexGrow: 0, flexShrink: 1 },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    marginBottom: 6,
  },
  label: { fontSize: 16, fontWeight: '600' },
  fullName: { fontSize: 12, marginTop: 2 },
});
