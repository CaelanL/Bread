import { InitialDot } from '@/components/shared/MemberDots';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { SharedMember } from '@/lib/shared/invites';
import type { SharedRole } from '@/lib/storage';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export const ROLE_LABEL: Record<SharedRole, string> = { owner: 'Owner', editor: 'Editor', member: 'Member' };

/** One member in the members sheet and Who's where. The owner taps another member for role and Remove. */
export function MemberRow({ member, you, manageable, disabled, last, onPress }: {
  member: SharedMember;
  you: boolean;
  manageable: boolean;
  disabled: boolean;
  /** No divider under the last row. */
  last?: boolean;
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
      style={[styles.member, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.borderLight }]}
    >
      <InitialDot name={member.displayName} you={you} large />
      <View style={styles.name}>
        <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>{member.displayName}</Text>
        {you && <Text style={[styles.secondary, { color: colors.icon }]}>You</Text>}
      </View>
      <Text style={[styles.secondary, { color: colors.icon }]}>{ROLE_LABEL[member.role]}</Text>
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
  },
  name: { flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  memberName: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
  secondary: { fontSize: 13, lineHeight: 18 },
});
