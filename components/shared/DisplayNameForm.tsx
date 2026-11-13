import { NameFields } from '@/components/shared/NameFields';
import { modalStyles } from '@/components/ui/ModalCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppStore } from '@/lib/store';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * The one-time name step before a first share or join. Continue saves through setName
 * (which shows its own toast on failure) and calls onDone only once the name is saved.
 */
export function DisplayNameForm({ onDone }: { onDone: () => void }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [first, setFirst] = useState(() => useAppStore.getState().firstName ?? '');
  const [last, setLast] = useState(() => useAppStore.getState().lastName ?? '');
  const [saving, setSaving] = useState(false);
  const ready = first.trim().length > 0 && !saving;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    await useAppStore.getState().setName(first, last);
    setSaving(false);
    if (useAppStore.getState().firstName === first.trim()) onDone();
  };

  return (
    <>
      <Text accessibilityRole="header" style={[modalStyles.title, styles.title, { color: colors.text }]}>Your name</Text>
      <View style={styles.fields}>
        <NameFields
          first={first}
          last={last}
          onChangeFirst={setFirst}
          onChangeLast={setLast}
          onSubmit={save}
          inputStyle={[modalStyles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
          editable={!saving}
          testIDPrefix="display-name-form"
        />
      </View>
      <Pressable
        testID="display-name-continue"
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready, busy: saving }}
        disabled={!ready}
        onPress={save}
        style={[modalStyles.button, { backgroundColor: ready || saving ? colors.text : colors.borderLight }]}
      >
        {saving
          ? <ActivityIndicator color={colors.background} />
          : <Text style={[modalStyles.buttonText, { color: colors.background }]}>Continue</Text>}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: 16 },
  fields: { gap: 10, marginBottom: 16 },
});
