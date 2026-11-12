import type { SharedMember } from '@/lib/shared/invites';
import type { SharedRole } from '@/lib/storage';
import { useAppStore } from '@/lib/store';
import { Alert } from 'react-native';

/** Runs a store write with the screen's busy state and an error toast on failure. */
type Run = (work: () => Promise<void>, fallback: string) => unknown;

function confirmRemove(sharedId: string, member: SharedMember, run: Run, onChange?: (role: SharedRole | null) => void) {
  Alert.alert(`Remove ${member.displayName}?`,
    "This collection leaves their Library, with their verses here that aren't mastered or in another collection.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => run(async () => {
          await useAppStore.getState().removeSharedMember(sharedId, member.userId);
          onChange?.(null);
        }, `Couldn't remove ${member.displayName}. Try again.`),
      },
    ]);
}

/**
 * The owner's choices for one member, from the members sheet and Who's where: Make editor or
 * Make member, and Remove. `onChange` gets the new role, or null once they're removed.
 */
export function manageMember(sharedId: string, member: SharedMember, run: Run, onChange?: (role: SharedRole | null) => void) {
  const role = member.role === 'editor' ? 'member' : 'editor';
  Alert.alert(member.displayName, member.role === 'editor'
    ? 'Editors add and remove verses for everyone.'
    : 'Make them an editor to let them add and remove verses for everyone.', [
    {
      text: role === 'editor' ? 'Make editor' : 'Make member',
      onPress: () => run(async () => {
        await useAppStore.getState().setSharedMemberRole(sharedId, member.userId, role);
        onChange?.(role);
      }, "Couldn't change their role. Try again."),
    },
    { text: 'Remove', style: 'destructive', onPress: () => confirmRemove(sharedId, member, run, onChange) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
