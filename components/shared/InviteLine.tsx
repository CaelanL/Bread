import { shareInvite, useCopyCode } from '@/components/shared/invite-actions';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Skeleton } from '@/components/ui/Skeleton';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getLiveInvite, type LiveInvite } from '@/lib/shared/invites';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const LINE = 20;

/**
 * The invite code in a collection's header, for a collection you shared that no one has joined
 * yet: the code with copy and share. Reads the code each time the screen comes into focus, so a
 * new code made on the share card shows on return; an expired one offers New code (the card).
 */
export function InviteLine({ sharedId, name, onManage }: { sharedId: string; name: string; onManage: () => void }) {
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

  if (failed && invite === undefined) {
    return (
      <Pressable testID="invite-strip" accessibilityRole="button" accessibilityLabel="Couldn't load the invite code. Retry" onPress={load} style={styles.line}>
        <Text style={[styles.text, { color: colors.icon }]}>Couldn&apos;t load the invite code.</Text>
        <Text style={[styles.text, styles.link, { color: colors.primary }]}>Retry</Text>
      </Pressable>
    );
  }
  if (invite === null) {
    return (
      <Pressable testID="invite-strip" accessibilityRole="button" accessibilityLabel="The invite code has expired. Make a new code" onPress={onManage} style={styles.line}>
        <Text style={[styles.text, { color: colors.icon }]}>The invite code has expired.</Text>
        <Text style={[styles.text, styles.link, { color: colors.primary }]}>New code</Text>
      </Pressable>
    );
  }
  return (
    <View testID="invite-strip" style={styles.line}>
      <Text style={[styles.text, { color: colors.icon }]}>Invite code</Text>
      {invite
        ? <Text testID="strip-invite-code" selectable style={[styles.text, styles.code, { color: colors.text }]}>{invite.code}</Text>
        : <Skeleton width={96} height={LINE} />}
      <Pressable
        testID="strip-copy-code"
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Code copied' : 'Copy code'}
        accessibilityState={{ disabled: !invite }}
        disabled={!invite}
        onPress={() => invite && copy(invite.code)}
        hitSlop={10}
        style={styles.action}
      >
        <IconSymbol name={copied ? 'checkmark' : 'square.on.square'} size={16} color={copied ? colors.success : colors.icon} />
      </Pressable>
      <Pressable
        testID="strip-share"
        accessibilityRole="button"
        accessibilityLabel="Share invite"
        accessibilityState={{ disabled: !invite }}
        disabled={!invite}
        onPress={() => invite && shareInvite(name, invite.code)}
        hitSlop={10}
        style={styles.action}
      >
        <IconSymbol name="square.and.arrow.up" size={16} color={colors.icon} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: LINE },
  text: { fontSize: 15, lineHeight: LINE },
  code: { fontWeight: '600', letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
  link: { fontWeight: '600' },
  action: { paddingHorizontal: 2 },
});
