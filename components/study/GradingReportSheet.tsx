import { Colors, InputText, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FEEDBACK_LIMITS } from '@/lib/feedback';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

interface GradingReportSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Resolves once the report is saved; a rejection keeps the sheet open with the note. */
  onSend: (note: string) => Promise<void>;
}

export function GradingReportSheet({ visible, onClose, onSend }: GradingReportSheetProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const canSend = note.trim().length > 0 && !sending;

  const send = async () => {
    setSending(true);
    setError(false);
    try {
      await onSend(note);
      setNote('');
      onClose();
    } catch (e) {
      console.error('[FEEDBACK] Grading report failed:', e);
      setError(true);
    }
    setSending(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={onClose} disabled={sending} />
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>Did we get your grading wrong?</Text>
          <Text style={[styles.copy, { color: colors.icon }]}>
            The more detail, the better we can fix it.
          </Text>
          <TextInput
            testID="grading-report-note"
            style={[styles.input, { color: colors.text, backgroundColor: colors.input, borderColor: colors.border }]}
            value={note}
            onChangeText={setNote}
            placeholder="What did you say, and what did Bread mark wrong?"
            placeholderTextColor={colors.icon}
            multiline
            maxLength={FEEDBACK_LIMITS.noteLength}
            autoFocus
            editable={!sending}
          />
          {error && (
            <Text style={[styles.error, { color: colors.error }]}>Couldn’t send. Check your connection and try again.</Text>
          )}
          <View style={styles.actions}>
            <Pressable
              testID="grading-report-cancel"
              accessibilityRole="button"
              style={[styles.button, { backgroundColor: colors.cardAlt }]}
              onPress={onClose}
              disabled={sending}
            >
              <Text style={[styles.buttonText, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            <Pressable
              testID="grading-report-send"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend }}
              style={[styles.button, { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.4 }]}
              onPress={send}
              disabled={!canSend}
            >
              {sending
                ? <ActivityIndicator color={colors.white} />
                : <Text style={[styles.buttonText, { color: colors.white }]}>Send</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: {
    width: '90%',
    maxWidth: 440,
    padding: 20,
    borderRadius: Radius.xxxl,
    gap: 12,
  },
  title: { fontSize: 18, fontWeight: '600' },
  copy: { fontSize: 14, lineHeight: 20 },
  input: {
    ...InputText,
    minHeight: 120,
    maxHeight: 220,
    padding: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  error: { fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  button: {
    flex: 1,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
