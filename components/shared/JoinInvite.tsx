import { DisplayNameForm } from '@/components/shared/DisplayNameForm';
import { MemberDots } from '@/components/shared/MemberDots';
import { ModalCard, modalStyles } from '@/components/ui/ModalCard';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUxFlagsStore } from '@/lib/notifications';
import { normalizeInviteCode, sharedErrorMessage } from '@/lib/shared/invite-code';
import { previewInvite, type InvitePreview } from '@/lib/shared/invites';
import { useAppStore, useHydrated } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The join modal for one code, shown by the link route and by the typed-code route. */
export function JoinInvite({ code: raw }: { code: string }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const code = normalizeInviteCode(raw);
  const hydrated = useHydrated();
  const translation = useAppStore((s) => s.bibleVersion);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'invite' | 'name'>('invite');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    useUxFlagsStore.getState().setInviteOpen(true);
    return () => useUxFlagsStore.getState().setInviteOpen(false);
  }, []);

  useEffect(() => {
    let current = true;
    setPreview(null);
    setError(null);
    previewInvite(code).then(
      (result) => { if (current) setPreview(result); },
      (e) => { if (current) setError(sharedErrorMessage(e, "Couldn't open this invite. Check your connection and try again.")); },
    );
    return () => { current = false; };
  }, [code]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(library)');
  };

  // Joining twice only syncs, so "Open" for an existing member runs the same call.
  const join = async () => {
    if (useAppStore.getState().displayName === null) {
      setStep('name');
      return;
    }
    setStep('invite');
    setJoining(true);
    try {
      const collectionId = await useAppStore.getState().joinSharedCollection(code);
      // One navigation: dismissAll then push resolves the push against the modal still on top,
      // which stacks a second copy of the tabs over the first.
      router.dismissTo(`/(tabs)/(library)/${collectionId}`);
    } catch (e) {
      showErrorToast(sharedErrorMessage(e, "Couldn't join. Try again."));
      setJoining(false);
    }
  };

  let body;
  if (step === 'name') {
    body = <DisplayNameForm onDone={join} />;
  } else if (error) {
    body = (
      <>
        <Text accessibilityRole="header" style={[modalStyles.title, { color: colors.text }]}>Invite unavailable</Text>
        <Text testID="join-error" style={[modalStyles.copy, styles.error, { color: colors.icon }]}>{error}</Text>
      </>
    );
  } else if (!preview) {
    body = <ActivityIndicator style={styles.loading} color={colors.icon} />;
  } else {
    const verses = plural(preview.verseCount, 'verse');
    body = (
      <>
        <Text style={[modalStyles.eyebrow, { color: colors.icon }]}>
          {preview.alreadyMember ? "You're in" : `${preview.inviterName} invited you`}
        </Text>
        <Text accessibilityRole="header" style={[modalStyles.name, { color: colors.text }]}>{preview.name}</Text>
        <Text style={[modalStyles.copy, { color: colors.icon }]}>{verses} · {plural(preview.memberCount, 'member')}</Text>
        <View style={styles.dots}>
          <MemberDots members={[{ name: preview.inviterName }]} count={preview.memberCount} />
        </View>
        <Text style={[modalStyles.copy, styles.privacy, { color: colors.icon }]}>
          {preview.verseCount === 1
            ? 'Members see how far along you are on this verse, including progress you already have on it.'
            : `Members see how far along you are on these ${verses}, including progress you already have on them.`}{' '}
          Nothing else in your library is shared. Verses show in your translation, {translation}.
        </Text>
        <Pressable
          testID="join-button"
          accessibilityRole="button"
          accessibilityState={{ disabled: !hydrated || joining, busy: joining }}
          disabled={!hydrated || joining}
          onPress={join}
          style={[modalStyles.button, { backgroundColor: colors.text }]}
        >
          {joining || !hydrated
            ? <ActivityIndicator color={colors.background} />
            : <Text style={[modalStyles.buttonText, { color: colors.background }]}>{preview.alreadyMember ? 'Open' : 'Join'}</Text>}
        </Pressable>
      </>
    );
  }

  return (
    <ModalCard onClose={close} closeDisabled={joining}>
      {body}
    </ModalCard>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48 },
  error: { marginTop: 6 },
  dots: { marginTop: 16, marginBottom: 16 },
  privacy: { marginBottom: 24 },
});
