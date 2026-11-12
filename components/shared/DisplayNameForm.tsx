import { modalStyles } from '@/components/ui/ModalCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth';
import { MAX_DISPLAY_NAME_LENGTH, prefillDisplayName } from '@/lib/shared/display-name';
import { useAppStore } from '@/lib/store';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';

/**
 * The one-time name step before a first share or join. Continue saves through setDisplayName
 * (which shows its own toast on failure) and calls onDone only once the name is saved.
 */
export function DisplayNameForm({ onDone }: { onDone: () => void }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const [draft, setDraft] = useState(() => useAppStore.getState().displayName ?? prefillDisplayName(user?.email));
  const [saving, setSaving] = useState(false);
  const name = draft.trim();

  const save = async () => {
    if (!name || saving) return;
    setSaving(true);
    await useAppStore.getState().setDisplayName(name);
    setSaving(false);
    if (useAppStore.getState().displayName === name) onDone();
  };

  return (
    <>
      <Text accessibilityRole="header" style={[modalStyles.title, { color: colors.text }]}>What should friends call you?</Text>
      <Text style={[modalStyles.copy, styles.copy, { color: colors.icon }]}>
        Members of shared collections see this name. You can change it in Settings.
      </Text>
      <TextInput
        testID="display-name-form-input"
        style={[modalStyles.input, styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
        value={draft}
        onChangeText={setDraft}
        placeholder="Name"
        placeholderTextColor={colors.icon}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={save}
        editable={!saving}
      />
      <Pressable
        testID="display-name-continue"
        accessibilityRole="button"
        accessibilityState={{ disabled: !name || saving, busy: saving }}
        disabled={!name || saving}
        onPress={save}
        style={[modalStyles.button, { backgroundColor: name ? colors.text : colors.borderLight }]}
      >
        {saving
          ? <ActivityIndicator color={colors.background} />
          : <Text style={[modalStyles.buttonText, { color: colors.background }]}>Continue</Text>}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  copy: { marginTop: 6, marginBottom: 20 },
  input: { marginBottom: 16 },
});
