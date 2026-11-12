import { DisplayNameForm } from '@/components/shared/DisplayNameForm';
import { SharePanel } from '@/components/shared/SharePanel';
import { ModalCard, modalStyles } from '@/components/ui/ModalCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { sharedErrorMessage } from '@/lib/shared/invite-code';
import { useAppStore } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput } from 'react-native';

type Step = 'name' | 'collection' | 'sharing' | 'panel';

/**
 * The share modal, for `com.biblemem://share/<collection id>` or `/share/new`: the one-time
 * display name if needed, then (for new) the collection's name, then shares it and shows the code
 * and members. Opening it for a collection that's already shared goes straight to the members.
 * A route, not an RN Modal, so an invite opened over it unwinds with it (see ModalCard).
 */
export default function ShareScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const colors = Colors[useColorScheme() ?? 'light'];
  const isNew = id === 'new';
  const alreadyShared = useAppStore((s) => !isNew && s.collections.some((c) => c.id === id && c.sharedId));
  const [target, setTarget] = useState(isNew ? null : id);
  const [step, setStep] = useState<Step>(() => {
    if (alreadyShared) return 'panel';
    if (useAppStore.getState().displayName === null) return 'name';
    return isNew ? 'collection' : 'sharing';
  });

  useEffect(() => {
    if (step !== 'sharing' || !target) return;
    let current = true;
    useAppStore.getState().shareCollection(target).then(
      () => { if (current) setStep('panel'); },
      (e) => {
        if (!current) return;
        showErrorToast(sharedErrorMessage(e, "Couldn't share this collection. Try again."));
        close();
      },
    );
    return () => { current = false; };
  }, [step, target]);

  const create = async (name: string) => {
    try {
      const collection = await useAppStore.getState().addCollection(name);
      setTarget(collection.id);
      setStep('sharing');
    } catch {
      showErrorToast('Failed to create collection.');
    }
  };

  let body;
  if (step === 'name') body = <DisplayNameForm onDone={() => setStep(isNew ? 'collection' : 'sharing')} />;
  else if (step === 'collection') body = <CollectionNameForm onSubmit={create} />;
  else if (step === 'sharing' || !target) body = <ActivityIndicator style={styles.loading} color={colors.icon} />;
  else body = <SharePanel collectionId={target} onLeft={() => router.dismissTo('/(tabs)/(library)')} />;

  return (
    <ModalCard onClose={close} closeDisabled={step === 'sharing'}>
      {body}
    </ModalCard>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)/(library)');
}

function CollectionNameForm({ onSubmit }: { onSubmit: (name: string) => Promise<void> }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const name = draft.trim();

  const submit = async () => {
    if (!name || busy) return;
    setBusy(true);
    await onSubmit(name);
    setBusy(false);
  };

  return (
    <>
      <Text accessibilityRole="header" style={[modalStyles.title, { color: colors.text }]}>New shared collection</Text>
      <Text style={[modalStyles.copy, styles.copy, { color: colors.icon }]}>
        Name it, then send the code to the people memorizing with you.
      </Text>
      <TextInput
        testID="collection-name"
        accessibilityLabel="Collection name"
        style={[modalStyles.input, styles.input, { backgroundColor: colors.input, color: colors.text, borderColor: colors.border }]}
        value={draft}
        onChangeText={setDraft}
        placeholder="e.g., Psalms of Comfort"
        placeholderTextColor={colors.icon}
        autoFocus
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      <Pressable
        testID="create-shared"
        accessibilityRole="button"
        accessibilityState={{ disabled: !name || busy, busy }}
        disabled={!name || busy}
        onPress={submit}
        style={[modalStyles.button, { backgroundColor: name ? colors.text : colors.borderLight }]}
      >
        {busy
          ? <ActivityIndicator color={colors.background} />
          : <Text style={[modalStyles.buttonText, { color: name ? colors.background : colors.icon }]}>Create and share</Text>}
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48 },
  copy: { marginTop: 6, marginBottom: 20 },
  input: { marginBottom: 16 },
});
