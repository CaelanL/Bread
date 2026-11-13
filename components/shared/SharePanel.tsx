import { shareInvite, useCopyCode } from '@/components/shared/invite-actions';
import { confirmRemoveCollection, confirmStopSharing, manageMember } from '@/components/shared/member-actions';
import { MemberRow, MemberRowPlaceholder } from '@/components/shared/MemberRow';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { modalStyles } from '@/components/ui/ModalCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth';
import { daysLeft, sharedErrorMessage } from '@/lib/shared/invite-code';
import { getLiveInvite, getSharedMembers, type LiveInvite, type SharedMember } from '@/lib/shared/invites';
import { collectionRemoval } from '@/lib/shared/progress';
import { useAppStore, useCollection, useSharedCollection } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// The code's and the days-left line's heights, which their stand-ins keep while the code loads.
const CODE_LINE = 36;
const META_LINE = 18;

/**
 * Members and invite for a shared collection, inside the share modal. The owner sees the code
 * with a copy icon, days left, Share (the invite text with the link), New code, Remove / role
 * changes per member and Stop sharing; everyone else sees the list and Leave. `members` shows
 * the member list alone (the collection screen's members line).
 * The name stays put above the scrolling part, so nothing scrolls under the modal's X.
 * It opens at its final size: members come from the group's grid when this device has it, or
 * stand-in rows for the known count, and the code and its days left are stand-ins of their height.
 */
export function SharePanel({ collectionId, view = 'all', onLeft, onStopped }: {
  collectionId: string;
  view?: 'all' | 'members';
  onLeft: () => void;
  onStopped: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const { user } = useAuth();
  const collection = useCollection(collectionId);
  const shared = useSharedCollection(collectionId);
  const sharedId = shared?.id;
  const isOwner = shared?.role === 'owner';
  const name = collection?.name ?? shared?.name ?? '';

  const [members, setMembers] = useState<SharedMember[] | null>(
    () => (sharedId && useAppStore.getState().sharedProgress[sharedId]?.members) || null);
  // Undefined until loaded; null when the code has expired.
  const [invite, setInvite] = useState<LiveInvite | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { copied: codeCopied, copy, reset: resetCopied } = useCopyCode();

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

  const copyCode = () => {
    if (invite) copy(invite.code);
  };

  const share = () => {
    if (invite) shareInvite(name, invite.code);
  };

  const newLink = () => {
    if (!sharedId) return;
    Alert.alert('Make a new code?', 'The current code and its link stop working.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New code',
        onPress: () => run(async () => {
          setInvite(await useAppStore.getState().mintInvite(sharedId));
          resetCopied();
        }, "Couldn't make a new code. Try again."),
      },
    ]);
  };

  const memberActions = (member: SharedMember) => {
    if (!sharedId) return;
    manageMember(sharedId, member, run, (role) => setMembers((list) => (role
      ? list?.map((m) => m.userId === member.userId ? { ...m, role } : m)
      : list?.filter((m) => m.userId !== member.userId)) ?? null));
  };

  const leave = () => confirmRemoveCollection(collectionId, { run, onDone: onLeft });

  const memberCount = members?.length ?? shared?.memberCount ?? 0;
  const othersJoined = memberCount > 1;

  const stopSharing = () => {
    if (!sharedId) return;
    confirmStopSharing(sharedId, name, members, memberCount, user?.id, { run, onDone: onStopped });
  };

  const plural = `${memberCount} member${memberCount === 1 ? '' : 's'}`;
  const eyebrow = view === 'members' ? plural : othersJoined ? `Shared · ${plural}` : 'Not shared yet';

  return (
    <>
      <Text style={[modalStyles.eyebrow, { color: colors.icon }]}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={[modalStyles.name, styles.name, { color: colors.text }]}>{name}</Text>
      <ScrollView testID="share-panel" bounces={false} style={modalStyles.edgeScroll} contentContainerStyle={modalStyles.edgeScrollContent}>
        {isOwner && view === 'all' && (
          <View style={[styles.invite, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
            {invite !== null ? (
              <>
                <Text style={[modalStyles.eyebrow, { color: colors.icon }]}>Invite code</Text>
                <View style={styles.codeRow}>
                  {invite
                    ? <Text testID="invite-code" selectable numberOfLines={1} adjustsFontSizeToFit style={[styles.code, { color: colors.text }]}>{invite.code}</Text>
                    : <Skeleton width={180} height={CODE_LINE} />}
                  <Pressable
                    testID="invite-copy-code"
                    accessibilityRole="button"
                    accessibilityLabel={codeCopied ? 'Code copied' : 'Copy code'}
                    accessibilityState={{ disabled: !invite }}
                    disabled={!invite}
                    onPress={copyCode}
                    hitSlop={12}
                    style={styles.copyCode}
                  >
                    <IconSymbol name={codeCopied ? 'checkmark' : 'square.on.square'} size={20} color={codeCopied ? colors.success : colors.icon} />
                    {codeCopied && <Text style={[modalStyles.meta, styles.copied, { color: colors.success }]}>Copied</Text>}
                  </Pressable>
                </View>
                {invite ? (
                  <Text style={[modalStyles.meta, { color: colors.icon }]}>
                    Expires in {daysLeft(invite.expiresAt)} day{daysLeft(invite.expiresAt) === 1 ? '' : 's'}
                  </Text>
                ) : <Skeleton width={120} height={META_LINE} />}
                {!othersJoined && (
                  <Text style={[modalStyles.meta, { color: colors.icon }]}>It stays a normal collection until someone joins.</Text>
                )}
                <Pressable testID="invite-share" accessibilityRole="button" accessibilityState={{ disabled: !invite }} disabled={!invite} onPress={share}
                  style={[modalStyles.button, styles.share, { backgroundColor: colors.text }]}>
                  <IconSymbol name="square.and.arrow.up" size={18} color={colors.background} />
                  <Text style={[modalStyles.buttonText, { color: colors.background }]}>Share</Text>
                </Pressable>
              </>
            ) : (
              <Text style={[modalStyles.meta, { color: colors.icon }]}>This code has expired. Make a new one to invite people.</Text>
            )}
            <Pressable testID="invite-new" accessibilityRole="button" onPress={newLink} disabled={busy || invite === undefined} style={styles.newLink}>
              <IconSymbol name="arrow.triangle.2.circlepath" size={14} color={colors.primary} />
              <Text style={[styles.newLinkText, { color: colors.primary }]}>New code</Text>
            </Pressable>
          </View>
        )}

        <Text style={[modalStyles.eyebrow, styles.membersLabel, { color: colors.icon }]}>Members</Text>
        {error ? (
          <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
            <Text style={[modalStyles.meta, { color: colors.text }]}>{error}</Text>
            <Text style={[styles.newLinkText, { color: colors.primary }]}>Retry</Text>
          </Pressable>
        ) : !members ? (
          Array.from({ length: memberCount }, (_, index) => <MemberRowPlaceholder key={index} last={index === memberCount - 1} />)
        ) : members.map((member, index) => {
          const you = member.userId === user?.id;
          return (
            <MemberRow key={member.userId} member={member} you={you} manageable={isOwner && !you} last={index === members.length - 1}
              disabled={busy} onPress={() => memberActions(member)} />
          );
        })}

        {view === 'all' && collectionRemoval(sharedId, shared?.role) === 'leave' && (
          <Pressable testID="shared-leave" accessibilityRole="button" onPress={leave} disabled={busy}
            style={[styles.leave, { borderColor: colors.border }]}>
            <Text style={[styles.buttonText, { color: colors.error }]}>Leave collection</Text>
          </Pressable>
        )}
        {view === 'all' && isOwner && (
          <Pressable testID="stop-sharing" accessibilityRole="button" onPress={stopSharing} disabled={busy}
            style={[styles.leave, { borderColor: colors.border }]}>
            <Text style={[styles.buttonText, { color: colors.error }]}>Stop sharing</Text>
          </Pressable>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  name: { marginBottom: 20 },
  invite: { borderRadius: Radius.xxl, borderWidth: 1, padding: 16, marginBottom: 24 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 4 },
  code: { flexShrink: 1, fontSize: 30, lineHeight: CODE_LINE, fontWeight: '600', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  copyCode: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copied: { fontWeight: '600' },
  share: { flexDirection: 'row', gap: 8, marginTop: 16 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  newLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingTop: 16 },
  newLinkText: { fontSize: 15, fontWeight: '600' },
  membersLabel: { marginBottom: 4 },
  retry: { paddingVertical: 16, gap: 6 },
  leave: {
    marginTop: 24,
    height: 48,
    borderRadius: Radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
