/**
 * Cadence picker for the Reviews digest. Two modes:
 *   daily  → single option, no weekday.
 *   weekly → 7 weekday options (Sun..Sat).
 *
 * Renders as a scrollable list with the current selection
 * highlighted. Save commits both `cadence` and `weekday`
 * (null when daily) atomically.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Cadence } from '@/lib/notifications';

interface Props {
  visible: boolean;
  initialCadence: Cadence;
  initialWeekday: number | null; // 0..6 (Sun..Sat) or null for daily
  onSave: (cadence: Cadence, weekday: number | null) => void;
  onClose: () => void;
}

const WEEKDAYS = [
  { value: 0, label: 'Every Sunday' },
  { value: 1, label: 'Every Monday' },
  { value: 2, label: 'Every Tuesday' },
  { value: 3, label: 'Every Wednesday' },
  { value: 4, label: 'Every Thursday' },
  { value: 5, label: 'Every Friday' },
  { value: 6, label: 'Every Saturday' },
];

interface Option {
  key: string;
  label: string;
  cadence: Cadence;
  weekday: number | null;
}

const OPTIONS: Option[] = [
  { key: 'daily', label: 'Daily', cadence: 'daily', weekday: null },
  ...WEEKDAYS.map((w) => ({
    key: `weekly-${w.value}`,
    label: w.label,
    cadence: 'weekly' as Cadence,
    weekday: w.value,
  })),
];

export function NotificationCadenceModal({ visible, initialCadence, initialWeekday, onSave, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Falls back to Monday when prior weekday was nulled by switching
  // to daily. The schema CHECK requires (cadence='weekly', weekday∈0..6)
  // OR (cadence='daily', weekday=null) — so server never holds a stale
  // weekday across daily/weekly transitions.
  const initialKey = initialCadence === 'daily' ? 'daily' : `weekly-${initialWeekday ?? 1}`;
  const [selected, setSelected] = useState<string>(initialKey);

  useEffect(() => {
    if (visible) setSelected(initialKey);
  }, [visible, initialKey]);

  const handleSave = () => {
    const opt = OPTIONS.find((o) => o.key === selected);
    if (!opt) return;
    onSave(opt.cadence, opt.weekday);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.container, { backgroundColor: colors.cardAlt }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.title, { color: colors.text }]}>Cadence</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {OPTIONS.map((opt) => {
              const isSelected = selected === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  style={[
                    styles.option,
                    isSelected && { backgroundColor: colors.primary },
                  ]}
                  onPress={() => setSelected(opt.key)}
                >
                  <Text style={[styles.optionLabel, { color: isSelected ? colors.white : colors.text }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={[styles.cancelButtonText, { color: colors.icon }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.saveButton, { backgroundColor: colors.primary }]}
              onPress={handleSave}
            >
              <Text style={[styles.saveButtonText, { color: colors.white }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '85%',
    maxHeight: '70%',
    borderRadius: 16,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  scroll: {
    flexGrow: 0,
  },
  option: {
    padding: 14,
    borderRadius: 10,
    marginBottom: 6,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
