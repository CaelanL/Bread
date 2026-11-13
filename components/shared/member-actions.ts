import { listNames } from '@/lib/shared/display-name';
import { sharedErrorMessage } from '@/lib/shared/invite-code';
import type { SharedMember } from '@/lib/shared/invites';
import { collectionRemoval, hasOtherMembers } from '@/lib/shared/progress';
import type { SharedRole } from '@/lib/storage';
import { useAppStore, versesLostWith } from '@/lib/store';
import { showErrorToast } from '@/lib/toast';
import { Alert } from 'react-native';

/** Runs a store write with the screen's busy state and an error toast on failure. */
type Run = (work: () => Promise<void>, fallback: string) => unknown;

/** The Run for a screen with no busy state: the error toast alone. */
async function toastOnFailure(work: () => Promise<void>, fallback: string) {
  try {
    await work();
  } catch (e) {
    showErrorToast(sharedErrorMessage(e, fallback));
  }
}

interface Hooks {
  /** Defaults to the error toast alone. */
  run?: Run;
  /** Once confirmed, before the write: for example, leave the screen that shows the collection. */
  onConfirm?: () => void;
  /** After the write succeeds. */
  onDone?: () => void;
  /** When nothing changed: cancelled, or the write failed. */
  onKept?: () => void;
}

/** A destructive confirm, then the write; a failure toasts `fallback`, which names the action. */
function confirmThen(title: string, message: string, action: string, write: () => Promise<void>, fallback: string,
  { run = toastOnFailure, onConfirm, onDone, onKept }: Hooks) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: onKept },
    {
      text: action,
      style: 'destructive',
      onPress: () => {
        onConfirm?.();
        void run(async () => {
          try {
            await write();
          } catch (e) {
            onKept?.();
            throw e;
          }
          onDone?.();
        }, fallback);
      },
    },
  ]);
}

// Same rule and wording as today's collection delete (docs/features/library.md#deleting-a-collection),
// with the count the store knows: not mastered and in no other collection.
function lostVerses(count: number): string {
  if (count === 0) return 'Your verses here are mastered or in another collection, so none are lost.';
  return `${count} verse${count === 1 ? '' : 's'} not mastered or in another collection will be deleted and lose progress.`;
}

/**
 * Confirms, then removes a collection from the Library with the store's `deleteCollection`: Leave
 * for a member; for the owner, Delete for everyone once others joined (members keep their copy);
 * otherwise a plain Delete. Nothing while a shared collection's role hasn't loaded.
 */
export function confirmRemoveCollection(collectionId: string, hooks: Hooks = {}) {
  const { collections, sharedCollections, verses } = useAppStore.getState();
  const collection = collections.find((c) => c.id === collectionId);
  const shared = collection?.sharedId ? sharedCollections[collection.sharedId] : undefined;
  const removal = collection && collectionRemoval(collection.sharedId, shared?.role);
  if (!collection || !removal) return;
  const lost = versesLostWith(collectionId);
  const write = () => useAppStore.getState().deleteCollection(collectionId);
  if (removal === 'leave') {
    confirmThen(`Leave "${collection.name}"?`, `It leaves your Library. ${lostVerses(lost)}`, 'Leave', write,
      "Couldn't leave this collection. Try again.", hooks);
  } else if (hasOtherMembers(shared)) {
    confirmThen('Delete for everyone?', `Members keep their own copy. ${lostVerses(lost)}`, 'Delete', write,
      'Failed to delete collection.', hooks);
  } else {
    confirmThen(`Delete "${collection.name}"?`, verses.some((v) => v.collectionId === collectionId)
      ? 'Verses not mastered or in another collection will be deleted and lose progress.'
      : 'This collection will be permanently deleted.', 'Delete', write, 'Failed to delete collection.', hooks);
  }
}

/**
 * Confirms, then stops sharing with the store's `stopSharing`: the group dissolves, the others keep
 * their own copy and the code dies. The confirm names the others once `members` is loaded, else
 * counts them from `memberCount`.
 */
export function confirmStopSharing(
  sharedId: string,
  name: string,
  members: Pick<SharedMember, 'userId' | 'displayName'>[] | null,
  memberCount: number,
  youId: string | undefined,
  hooks: Hooks = {},
) {
  const others = members?.filter((m) => m.userId !== youId).map((m) => m.displayName);
  const count = others ? others.length : Math.max(memberCount - 1, 0);
  const who = others ? listNames(others) : `The other ${count === 1 ? 'member' : `${count} members`}`;
  confirmThen(`Stop sharing "${name}"?`, count > 0
    ? `${who} will keep their own copy, but you'll stop seeing each other's progress. The code stops working.`
    : 'The code stops working. The collection stays in your Library.', 'Stop sharing',
  () => useAppStore.getState().stopSharing(sharedId), "Couldn't stop sharing. Try again.", hooks);
}

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
