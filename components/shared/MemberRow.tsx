import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SharedMember } from '@/lib/shared/invites';
import type { SharedRole } from '@/lib/storage';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const ROLE_LABEL: Record<SharedRole, string> = { owner: 'Owner', editor: 'Editor', member: 'Member' };

/** One member in the members sheet and Who's where. The owner taps another member for role and Remove. */
export function MemberRow({ member, you, manageable, disabled, onPress }: {
  member: SharedMember;
  you: boolean;
  manageable: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable
      testID={`member-${member.displayName}`}
      accessibilityRole={manageable ? 'button' : undefined}
      accessibilityLabel={`${member.displayName}${you ? ', you' : ''}, ${ROLE_LABEL[member.role]}`}
      disabled={!manageable || disabled}
      onPress={onPress}
      style={[styles.member, { borderColor: colors.borderLight }]}
    >
      <View style={[styles.dot, { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.initial, { color: colors.text }]}>{member.displayName.charAt(0).toUpperCase()}</Text>
      </View>
      <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
        {member.displayName}{you ? ' (you)' : ''}
      </Text>
      <Text style={[styles.role, { color: colors.icon }]}>{ROLE_LABEL[member.role]}</Text>
      {manageable && <IconSymbol name="ellipsis" size={16} color={colors.icon} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 32, height: 32, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  initial: { fontSize: 13, fontWeight: '600' },
  memberName: { flex: 1, fontSize: 16 },
  role: { fontSize: 14 },
});
