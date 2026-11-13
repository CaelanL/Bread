import { NameFields } from '@/components/shared/NameFields';
import { Colors, Radius, InputText } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  visible: boolean;
  /** The saved names, or null when none is saved yet. */
  savedFirst: string | null;
  savedLast: string | null;
  onSave: (firstName: string, lastName: string) => void;
  onClose: () => void;
}

/** First and last name; nothing is written until Save. */
export function DisplayNameModal({ visible, savedFirst, savedLast, onSave, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [first, setFirst] = useState(savedFirst ?? '');
  const [last, setLast] = useState(savedLast ?? '');

  useEffect(() => {
    if (!visible) return;
    setFirst(savedFirst ?? '');
    setLast(savedLast ?? '');
  }, [visible, savedFirst, savedLast]);

  const canSave = first.trim().length > 0
    && (first.trim() !== savedFirst || (last.trim() || null) !== savedLast);

  const handleSave = () => {
    if (!canSave) return;
    onSave(first, last);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable accessible={false} style={styles.overlay} onPress={onClose}>
          <View
            style={[styles.container, { backgroundColor: colors.cardAlt }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.title, { color: colors.text }]}>Your name</Text>
            <View style={styles.fields}>
              <NameFields
                first={first}
                last={last}
                onChangeFirst={setFirst}
                onChangeLast={setLast}
                onSubmit={handleSave}
                inputStyle={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.borderLight }]}
                testIDPrefix="display-name"
              />
            </View>
            <View style={styles.buttonRow}>
              <Pressable style={styles.button} onPress={onClose}>
                <Text style={[styles.cancelText, { color: colors.icon }]}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="display-name-save"
                style={[styles.button, { backgroundColor: canSave ? colors.primary : colors.borderLight }]}
                onPress={handleSave}
                disabled={!canSave}
              >
                <Text style={[styles.saveText, { color: canSave ? colors.white : colors.icon }]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '88%',
    borderRadius: Radius.xxl,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  fields: {
    gap: 10,
  },
  input: {
    ...InputText,
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
  saveText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
