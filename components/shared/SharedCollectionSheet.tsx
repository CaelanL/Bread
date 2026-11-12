import { confirmLeave } from '@/components/shared/confirm-removal';
import { manageMember } from '@/components/shared/member-actions';
import { MemberRow } from '@/components/shared/MemberRow';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth';
import { daysLeft, inviteLink, inviteMessage, sharedErrorMessage } from '@/lib/shared/invite-code';
import { copyText, getLiveInvite, getSharedMembers, type LiveInvite, type SharedMember } from '@/lib/shared/invites';
import { useAppStore, useCollection, useSharedCollection, useVersesLostWith } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

/**
 * Members and invite for a shared collection. The owner sees the link and code, Copy, Share,
 * New link, and Remove / role changes per member; everyone else sees the list and Leave.
 */
export function SharedCollectionSheet({ collectionId, onClose, onLeft }: {
  collectionId: string;
  onClose: () => void;
  onLeft: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const collection = useCollection(collectionId);
  const shared = useSharedCollection(collectionId);
  const lost = useVersesLostWith(collectionId);
  const sharedId = shared?.id;
  const isOwner = shared?.role === 'owner';
  const name = collection?.name ?? shared?.name ?? '';

  const [members, setMembers] = useState<SharedMember[] | null>(null);
  const [invite, setInvite] = useState<LiveInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!sharedId) return;
    setError(null);
    try {
      const [list, live] = await Promise.all([getSharedMembers(sharedId), isOwner ? getLiveInvite(sharedId) : null]);
      setMembers(list);
      setInvite(live);
    } catch (e) {
      setError(sharedErrorMessage(e, "Couldn't load the members. Try again."));
    }
  }, [sharedId, isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      showErrorToast(sharedErrorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    if (!invite) return;
    try {
      copyText(inviteMessage(name, invite.code));
      if (process.env.EXPO_OS === 'ios') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCopied(true);
    } catch {
      showErrorToast("Couldn't copy the link. Use Share instead.");
    }
  };

  const share = () => {
    if (!invite) return;
    Share.share({ message: inviteMessage(name, invite.code) }).catch(() => {
      showErrorToast("Couldn't open sharing. Try Copy link instead.");
    });
  };

  const newLink = () => {
    if (!sharedId) return;
    Alert.alert('Make a new link?', 'The current link and code stop working.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New link',
        onPress: () => run(async () => {
          setInvite(await useAppStore.getState().mintInvite(sharedId));
          setCopied(false);
        }, "Couldn't make a new link. Try again."),
      },
    ]);
  };

  const memberActions = (member: SharedMember) => {
    if (!sharedId) return;
    manageMember(sharedId, member, run, (role) => setMembers((list) => (role
      ? list?.map((m) => m.userId === member.userId ? { ...m, role } : m)
      : list?.filter((m) => m.userId !== member.userId)) ?? null));
  };

  const leave = () => {
    if (!sharedId) return;
    confirmLeave(name, lost, () => run(async () => {
      await useAppStore.getState().leaveSharedCollection(sharedId);
      onLeft();
    }, "Couldn't leave this collection. Try again."));
  };

  const memberCount = members?.length ?? shared?.memberCount ?? 0;

  return (
    <BottomSheet onClose={onClose}>
      <ScrollView testID="shared-sheet" bounces={false} contentContainerStyle={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.icon }]}>Shared · {memberCount} member{memberCount === 1 ? '' : 's'}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{name}</Text>

        {isOwner && (
          <View style={[styles.invite, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            {invite ? (
              <>
                <Text style={[styles.label, { color: colors.icon }]}>Invite code</Text>
                <Text testID="invite-code" selectable style={[styles.code, { color: colors.text }]}>{invite.code}</Text>
                <Text selectable style={[styles.link, { color: colors.icon }]}>{inviteLink(invite.code)}</Text>
                <Text style={[styles.link, { color: colors.icon }]}>
                  Expires in {daysLeft(invite.expiresAt)} day{daysLeft(invite.expiresAt) === 1 ? '' : 's'}
                </Text>
                <View style={styles.buttons}>
                  <Pressable testID="invite-copy" accessibilityRole="button" onPress={copy}
                    style={[styles.button, { backgroundColor: colors.text }]}>
                    <IconSymbol name={copied ? 'checkmark' : 'doc.on.doc'} size={16} color={colors.background} />
                    <Text style={[styles.buttonText, { color: colors.background }]}>{copied ? 'Copied' : 'Copy link'}</Text>
                  </Pressable>
                  <Pressable testID="invite-share" accessibilityRole="button" onPress={share}
                    style={[styles.button, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
                    <IconSymbol name="square.and.arrow.up" size={16} color={colors.text} />
                    <Text style={[styles.buttonText, { color: colors.text }]}>Share</Text>
                  </Pressable>
                </View>
              </>
            ) : members && (
              <Text style={[styles.link, { color: colors.icon }]}>This link has expired. Make a new one to invite people.</Text>
            )}
            {members && (
              <Pressable testID="invite-new" accessibilityRole="button" onPress={newLink} disabled={busy} style={styles.newLink}>
                <IconSymbol name="arrow.triangle.2.circlepath" size={14} color={colors.primary} />
                <Text style={[styles.newLinkText, { color: colors.primary }]}>New link</Text>
              </Pressable>
            )}
          </View>
        )}

        <Text style={[styles.label, styles.membersLabel, { color: colors.icon }]}>Members</Text>
        {error ? (
          <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
            <Text style={[styles.link, { color: colors.text }]}>{error}</Text>
            <Text style={[styles.newLinkText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        ) : !members ? (
          <ActivityIndicator style={styles.retry} color={colors.icon} />
        ) : members.map((member) => {
          const you = member.userId === user?.id;
          return (
            <MemberRow key={member.userId} member={member} you={you} manageable={isOwner && !you}
              disabled={busy} onPress={() => memberActions(member)} />
          );
        })}

        {shared && !isOwner && (
          <Pressable testID="shared-leave" accessibilityRole="button" onPress={leave} disabled={busy}
            style={[styles.leave, { borderColor: colors.border }]}>
            <Text style={[styles.buttonText, { color: colors.error }]}>Leave collection</Text>
          </Pressable>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 4 },
  eyebrow: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontFamily: Fonts.serif, fontSize: 24, marginTop: 4, marginBottom: 16 },
  invite: { borderRadius: Radius.xxl, borderWidth: 1, padding: 16, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  code: { fontSize: 30, fontWeight: '600', letterSpacing: 4, marginTop: 4, marginBottom: 6, fontVariant: ['tabular-nums'] },
  link: { fontSize: 13, lineHeight: 19 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  newLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingTop: 14 },
  newLinkText: { fontSize: 14, fontWeight: '600' },
  membersLabel: { marginBottom: 4 },
  retry: { paddingVertical: 16, gap: 6 },
  leave: {
    marginTop: 20,
    height: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
