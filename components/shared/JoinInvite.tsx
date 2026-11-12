import { DisplayNameForm } from '@/components/shared/DisplayNameSheet';
import { MemberDots } from '@/components/shared/MemberDots';
import { SheetLayout } from '@/components/ui/BottomSheet';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { normalizeInviteCode, sharedErrorMessage } from '@/lib/shared/invite-code';
import { previewInvite, type InvitePreview } from '@/lib/shared/invites';
import { useAppStore, useHydrated } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The join sheet for one code, shown by the link route and by the typed-code route. */
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
      router.dismissAll();
      router.push(`/(tabs)/(library)/${collectionId}`);
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
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Invite unavailable</Text>
        <Text testID="join-error" style={[styles.copy, { color: colors.icon }]}>{error}</Text>
      </>
    );
  } else if (!preview) {
    body = <ActivityIndicator style={styles.loading} color={colors.icon} />;
  } else {
    const verses = plural(preview.verseCount, 'verse');
    body = (
      <>
        <Text style={[styles.eyebrow, { color: colors.icon }]}>
          {preview.alreadyMember ? "You're in" : `${preview.inviterName} invited you`}
        </Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{preview.name}</Text>
        <Text style={[styles.meta, { color: colors.icon }]}>{verses} · {plural(preview.memberCount, 'member')}</Text>
        <View style={styles.dots}>
          <MemberDots names={[preview.inviterName]} count={preview.memberCount} />
        </View>
        <Text style={[styles.copy, { color: colors.icon }]}>
          Members see how far along you are on these {verses}, including progress you already have on them.
          Nothing else in your library is shared. Verses show in your translation, {translation}.
        </Text>
        <Pressable
          testID="join-button"
          accessibilityRole="button"
          accessibilityState={{ disabled: !hydrated || joining, busy: joining }}
          disabled={!hydrated || joining}
          onPress={join}
          style={[styles.button, { backgroundColor: colors.text }]}
        >
          {joining || !hydrated
            ? <ActivityIndicator color={colors.background} />
            : <Text style={[styles.buttonText, { color: colors.background }]}>{preview.alreadyMember ? 'Open' : 'Join'}</Text>}
        </Pressable>
      </>
    );
  }

  return (
    <SheetLayout onClose={close}>
      {body}
      {step === 'invite' && (
        <Pressable testID="join-not-now" accessibilityRole="button" onPress={close} disabled={joining} style={styles.ghost}>
          <Text style={[styles.ghostText, { color: colors.icon }]}>Not now</Text>
        </Pressable>
      )}
    </SheetLayout>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: 48 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.serif, fontSize: 26, marginTop: 4, marginBottom: 4 },
  meta: { fontSize: 15 },
  dots: { marginTop: 12, marginBottom: 16 },
  copy: { fontSize: 14, lineHeight: 21, marginBottom: 20 },
  button: {
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  ghost: { alignItems: 'center', paddingTop: 14, paddingBottom: 4 },
  ghostText: { fontSize: 15, fontWeight: '500' },
});
