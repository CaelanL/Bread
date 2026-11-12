import { shareInvite, useCopyCode } from '@/components/shared/invite-actions';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Skeleton } from '@/components/ui/Skeleton';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getLiveInvite, type LiveInvite } from '@/lib/shared/invites';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const CODE_LINE = 28;

/**
 * Where the group card sits, for a collection you shared that no one has joined yet: the invite
 * code with copy and share, and the gear to the share panel (New code, Stop sharing). Reads the
 * code each time the screen comes into focus, so a new code made on the panel shows on return.
 */
export function InviteStrip({ sharedId, name, onSettings }: { sharedId: string; name: string; onSettings: () => void }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  // Undefined until loaded; null when the code has expired.
  const [invite, setInvite] = useState<LiveInvite | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const { copied, copy } = useCopyCode();

  const load = useCallback(() => {
    let current = true;
    getLiveInvite(sharedId).then(
      (live) => { if (current) { setInvite(live); setFailed(false); } },
      () => { if (current) setFailed(true); },
    );
    return () => { current = false; };
  }, [sharedId]);
  useFocusEffect(load);

  let body;
  if (failed && invite === undefined) {
    body = (
      <Pressable accessibilityRole="button" accessibilityLabel="Couldn't load the code. Retry" onPress={load} style={styles.message}>
        <Text style={[styles.meta, { color: colors.text }]}>Couldn&apos;t load the code.</Text>
        <Text style={[styles.link, { color: colors.primary }]}>Retry</Text>
      </Pressable>
    );
  } else if (invite === null) {
    body = (
      <Pressable accessibilityRole="button" accessibilityLabel="This code has expired. Make a new code" onPress={onSettings} style={styles.message}>
        <Text style={[styles.meta, { color: colors.text }]}>This code has expired.</Text>
        <Text style={[styles.link, { color: colors.primary }]}>New code</Text>
      </Pressable>
    );
  } else {
    body = (
      <View style={styles.codeRow}>
        <View style={styles.codeBox}>
          {invite
            ? <Text testID="strip-invite-code" selectable numberOfLines={1} adjustsFontSizeToFit style={[styles.code, { color: colors.text }]}>{invite.code}</Text>
            : <Skeleton width={140} height={CODE_LINE} />}
        </View>
        <Pressable
          testID="strip-copy-code"
          accessibilityRole="button"
          accessibilityLabel={copied ? 'Code copied' : 'Copy code'}
          accessibilityState={{ disabled: !invite }}
          disabled={!invite}
          onPress={() => invite && copy(invite.code)}
          hitSlop={8}
          style={styles.action}
        >
          <IconSymbol name={copied ? 'checkmark' : 'square.on.square'} size={20} color={copied ? colors.success : colors.icon} />
        </Pressable>
        <Pressable
          testID="strip-share"
          accessibilityRole="button"
          accessibilityLabel="Share invite"
          accessibilityState={{ disabled: !invite }}
          disabled={!invite}
          onPress={() => invite && shareInvite(name, invite.code)}
          hitSlop={8}
          style={styles.action}
        >
          <IconSymbol name="square.and.arrow.up" size={20} color={colors.icon} />
        </Pressable>
      </View>
    );
  }

  return (
    <View testID="invite-strip" style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Text style={[styles.meta, styles.heading, { color: colors.icon }]} numberOfLines={1}>
          Invite code · No one has joined yet
        </Text>
        <Pressable testID="shared-settings" accessibilityRole="button" accessibilityLabel="Sharing settings" onPress={onSettings} hitSlop={8}>
          <IconSymbol name="gearshape" size={18} color={colors.icon} />
        </Pressable>
      </View>
      {body}
    </View>
  );
}

// The shell matches the group card (`SharedStrip`), which takes this place once someone joins.
const styles = StyleSheet.create({
  strip: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { flex: 1 },
  meta: { fontSize: 13, lineHeight: 18 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  codeBox: { flex: 1 },
  code: { fontSize: 22, lineHeight: CODE_LINE, fontWeight: '600', letterSpacing: 3, fontVariant: ['tabular-nums'] },
  action: { padding: 2 },
  message: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: CODE_LINE },
  link: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
