/**
 * Modal for picking the user's maximum review interval. Wraps a
 * native iOS-style wheel picker with explainer copy and a Save/Cancel
 * commit gesture.
 *
 * Open via `visible={true}`. The modal owns its own draft state —
 * the parent only sees the chosen value when the user taps Save.
 * Cancel / overlay-tap discards.
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WheelPicker } from './WheelPicker';

interface Props {
  visible: boolean;
  initialValue: number;
  min: number;
  max: number;
  onSave: (value: number) => void;
  onClose: () => void;
}

export function ReviewIntervalModal({ visible, initialValue, min, max, onSave, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [draft, setDraft] = useState(initialValue);

  // Reset draft each time the modal re-opens. Without this, a user
  // who opens → scrubs → cancels → reopens would see their abandoned
  // draft instead of the saved value.
  useEffect(() => {
    if (visible) setDraft(initialValue);
  }, [visible, initialValue]);

  const dirty = draft !== initialValue;

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.container, { backgroundColor: colors.cardAlt }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.title, { color: colors.text }]}>Maximum review interval</Text>
          <Text style={[styles.copy, { color: colors.icon }]}>
            Applies to future reviews only — your queued schedules stay where they are, and your progress isn&apos;t reset.
          </Text>

          <View style={styles.pickerWrapper}>
            <WheelPicker value={draft} min={min} max={max} onChange={setDraft} />
          </View>

          <View style={styles.buttonRow}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={[styles.cancelButtonText, { color: colors.icon }]}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[
                styles.saveButton,
                { backgroundColor: dirty ? colors.primary : colors.borderLight },
              ]}
              onPress={handleSave}
              disabled={!dirty}
            >
              <Text
                style={[
                  styles.saveButtonText,
                  { color: dirty ? colors.white : colors.icon },
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
    width: '88%',
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  copy: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  pickerWrapper: {
    paddingVertical: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  cancelButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
    justifyContent: 'center',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
