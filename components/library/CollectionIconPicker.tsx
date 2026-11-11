import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { COLLECTION_ICONS, DEFAULT_COLLECTION_ICON, isCollectionIconKey, type CollectionIconKey } from '@/lib/collections/icons';

const iconKeys = Object.keys(COLLECTION_ICONS).filter(isCollectionIconKey);

export function CollectionIconPicker({ currentKey, onSave, onClose }: {
  currentKey?: CollectionIconKey;
  onSave: (key: CollectionIconKey) => Promise<void>;
  onClose: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { bottom } = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const columns = fontScale > 1.6 ? 2 : width < 360 || fontScale > 1.2 ? 3 : 4;
  const initial = currentKey ?? DEFAULT_COLLECTION_ICON;
  const [selected, setSelected] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);

  const close = () => {
    if (!inFlight.current) onClose();
  };

  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      if (selected !== initial) await onSave(selected);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the icon. Try again.');
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  };

  return (
    <Modal transparent visible animationType="slide" onRequestClose={close}>
      <View style={styles.modal}>
        <Pressable
          accessible={false}
          onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}
        />
        <View accessibilityViewIsModal style={[styles.sheet, {
          backgroundColor: colors.card,
          paddingBottom: Math.max(bottom, 16),
        }]}>
          <View style={styles.header}>
            <View style={styles.titleBlock}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
                Collection icon
              </Text>
              <Text style={[styles.subtitle, { color: colors.icon }]}>Choose a symbol for this collection.</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel icon changes"
              disabled={saving}
              onPress={close}
              style={[styles.close, { backgroundColor: colors.cardAlt }]}
            >
              <IconSymbol name="xmark" size={18} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.grid} testID="collection-icon-grid">
            {iconKeys.map((key) => {
              const { label, symbol } = COLLECTION_ICONS[key];
              const active = selected === key;
              return (
                <View key={key} style={[styles.cell, { width: `${100 / columns}%` }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: active, disabled: saving }}
                    disabled={saving}
                    testID={`choose-collection-icon-${key}`}
                    onPress={() => {
                      setSelected(key);
                      setError(undefined);
                    }}
                    style={[styles.choice, {
                      backgroundColor: active ? colors.primaryLight : colors.cardAlt,
                      borderColor: active ? colors.primary : colors.border,
                    }]}
                  >
                    {active && (
                      <View style={styles.check}>
                        <IconSymbol name="checkmark" size={13} color={colors.text} />
                      </View>
                    )}
                    <IconSymbol name={symbol} size={24} color={colors.text} />
                    <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          {error && (
            <Text accessibilityLiveRegion="polite" style={[styles.error, { color: colors.text }]}>{error}</Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving, busy: saving }}
            disabled={saving}
            onPress={save}
            style={[styles.save, { backgroundColor: colors.primary }]}
          >
            {saving && <ActivityIndicator color={Colors.light.text} />}
            <Text style={[styles.saveText, { color: Colors.light.text }]}>{saving ? 'Saving…' : 'Save icon'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '78%',
    alignSelf: 'center',
    borderTopLeftRadius: Radius.huge,
    borderTopRightRadius: Radius.huge,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleBlock: { flex: 1, gap: 4 },
  title: { fontSize: 22, fontWeight: '700' },
  subtitle: { fontSize: 15 },
  close: {
    width: 44,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flexGrow: 0, flexShrink: 1, minHeight: 80 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { padding: 4 },
  choice: {
    flex: 1,
    minHeight: 76,
    borderWidth: 1,
    borderRadius: Radius.lg,
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  check: { position: 'absolute', top: 5, right: 5 },
  label: { fontSize: 12, fontWeight: '500', textAlign: 'center' },
  error: { fontSize: 14 },
  save: {
    minHeight: 48,
    borderRadius: Radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveText: { fontSize: 16, fontWeight: '700' },
});
