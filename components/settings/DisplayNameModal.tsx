import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MAX_DISPLAY_NAME_LENGTH } from '@/lib/shared/display-name';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

interface Props {
  visible: boolean;
  /** The saved name, or null when none is saved yet. */
  savedName: string | null;
  prefill: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

/** One field; nothing is written until Save. */
export function DisplayNameModal({ visible, savedName, prefill, onSave, onClose }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [draft, setDraft] = useState(savedName ?? prefill);

  useEffect(() => {
    if (visible) setDraft(savedName ?? prefill);
  }, [visible, savedName, prefill]);

  const name = draft.trim();
  const canSave = name.length > 0 && name !== savedName;

  const handleSave = () => {
    if (!canSave) return;
    onSave(name);
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
            <Text style={[styles.copy, { color: colors.icon }]}>What friends see in shared collections.</Text>
            <TextInput
              testID="display-name-input"
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.borderLight }]}
              value={draft}
              onChangeText={setDraft}
              placeholder="Name"
              placeholderTextColor={colors.icon}
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              autoCapitalize="words"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
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
    marginBottom: 8,
  },
  copy: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    padding: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    fontSize: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
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
