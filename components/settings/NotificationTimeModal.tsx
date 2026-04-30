/**
 * Time picker for notification fire-time. Three wheels: 12-hour,
 * minute (in 5-minute steps), and AM/PM. Schema CHECK enforces 1 AM
 * through 11:59 PM, so the hour wheel excludes 12 AM.
 *
 * Used by both the Reviews source and In-progress source rows in
 * Settings. Owns its own draft state; parent receives 24-hour
 * (hour, minute) on Save.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Picker } from '@react-native-picker/picker';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  title: string;
  initialHour: number;     // 0..23
  initialMinute: number;   // 0..59
  onSave: (hour24: number, minute: number) => void;
  onClose: () => void;
}

const MINUTE_STEP = 5;

function to12Hour(h24: number): { h12: number; period: 'AM' | 'PM' } {
  if (h24 === 0) return { h12: 12, period: 'AM' };
  if (h24 < 12) return { h12: h24, period: 'AM' };
  if (h24 === 12) return { h12: 12, period: 'PM' };
  return { h12: h24 - 12, period: 'PM' };
}

function to24Hour(h12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') {
    return h12 === 12 ? 0 : h12;
  }
  return h12 === 12 ? 12 : h12 + 12;
}

function snapMinute(m: number): number {
  // Snap arbitrary minute to the nearest MINUTE_STEP.
  const snapped = Math.round(m / MINUTE_STEP) * MINUTE_STEP;
  return snapped >= 60 ? 0 : snapped;
}

export function NotificationTimeModal({ visible, title, initialHour, initialMinute, onSave, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const initial = to12Hour(initialHour);
  const [hour, setHour] = useState(initial.h12);
  const [minute, setMinute] = useState(snapMinute(initialMinute));
  const [period, setPeriod] = useState<'AM' | 'PM'>(initial.period);

  useEffect(() => {
    if (visible) {
      const v = to12Hour(initialHour);
      setHour(v.h12);
      setMinute(snapMinute(initialMinute));
      setPeriod(v.period);
    }
  }, [visible, initialHour, initialMinute]);

  const hours = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const minutes = useMemo(() => {
    const arr: number[] = [];
    for (let m = 0; m < 60; m += MINUTE_STEP) arr.push(m);
    return arr;
  }, []);

  const handleSave = () => {
    let h24 = to24Hour(hour, period);
    // Schema CHECK: reviews_hour BETWEEN 1 AND 23. Block 12 AM (h24 === 0).
    if (h24 === 0) h24 = 1;
    onSave(h24, minute);
    onClose();
  };

  // Disable Save when the current selection would resolve to 12 AM —
  // the schema doesn't accept it.
  const isMidnight = period === 'AM' && hour === 12;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.container, { backgroundColor: colors.cardAlt }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {isMidnight && (
            <Text style={[styles.warning, { color: colors.error }]}>
              Earliest selectable time is 1:00 AM.
            </Text>
          )}

          <View style={styles.row}>
            <Picker
              selectedValue={hour}
              onValueChange={(v) => setHour(Number(v))}
              itemStyle={[styles.item, { color: colors.text }]}
              style={styles.picker}
            >
              {hours.map((h) => (
                <Picker.Item key={h} label={String(h)} value={h} color={colors.text} />
              ))}
            </Picker>
            <Text style={[styles.colon, { color: colors.text }]}>:</Text>
            <Picker
              selectedValue={minute}
              onValueChange={(v) => setMinute(Number(v))}
              itemStyle={[styles.item, { color: colors.text }]}
              style={styles.picker}
            >
              {minutes.map((m) => (
                <Picker.Item key={m} label={String(m).padStart(2, '0')} value={m} color={colors.text} />
              ))}
            </Picker>
            <Picker
              selectedValue={period}
              onValueChange={(v) => setPeriod(v as 'AM' | 'PM')}
              itemStyle={[styles.item, { color: colors.text }]}
              style={styles.picker}
            >
              <Picker.Item label="AM" value="AM" color={colors.text} />
              <Picker.Item label="PM" value="PM" color={colors.text} />
            </Picker>
          </View>

          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={[styles.cancelButtonText, { color: colors.icon }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.saveButton,
                { backgroundColor: isMidnight ? colors.borderLight : colors.primary },
              ]}
              onPress={handleSave}
              disabled={isMidnight}
            >
              <Text
                style={[
                  styles.saveButtonText,
                  { color: isMidnight ? colors.icon : colors.white },
                ]}
              >
                Save
              </Text>
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
    borderRadius: 16,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  warning: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 200,
  },
  picker: {
    flex: 1,
    height: 200,
  },
  colon: {
    fontSize: 22,
    fontWeight: '600',
    marginHorizontal: 4,
  },
  item: {
    fontSize: 22,
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
