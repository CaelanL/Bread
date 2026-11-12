import { Alert } from 'react-native';

// Same rule and wording as today's collection delete (docs/features/library.md#deleting-a-collection),
// with the count the store knows: not mastered and in no other collection.
function lostVerses(count: number): string {
  if (count === 0) return 'Your verses here are mastered or in another collection, so none are lost.';
  return `${count} verse${count === 1 ? '' : 's'} not mastered or in another collection will be deleted and lose progress.`;
}

export function confirmLeave(name: string, lost: number, onConfirm: () => void, onCancel?: () => void) {
  Alert.alert(`Leave "${name}"?`, `It leaves your Library. ${lostVerses(lost)}`, [
    { text: 'Cancel', style: 'cancel', onPress: onCancel },
    { text: 'Leave', style: 'destructive', onPress: onConfirm },
  ]);
}

export function confirmDeleteForEveryone(lost: number, onConfirm: () => void, onCancel?: () => void) {
  Alert.alert('Delete for everyone?', `Members keep their own copy. ${lostVerses(lost)}`, [
    { text: 'Cancel', style: 'cancel', onPress: onCancel },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

/** Delete for a collection only you are in (docs/features/library.md#deleting-a-collection). */
export function confirmDeleteCollection(name: string, verseCount: number, onConfirm: () => void, onCancel?: () => void) {
  Alert.alert(`Delete "${name}"?`, verseCount > 0
    ? 'Verses not mastered or in another collection will be deleted and lose progress.'
    : 'This collection will be permanently deleted.', [
    { text: 'Cancel', style: 'cancel', onPress: onCancel },
    { text: 'Delete', style: 'destructive', onPress: onConfirm },
  ]);
}

export function confirmStopSharing(name: string, othersJoined: boolean, onConfirm: () => void) {
  Alert.alert(`Stop sharing "${name}"?`, othersJoined
    ? 'The code stops working, and each member keeps their own copy. The collection stays in your Library.'
    : 'The code stops working. The collection stays in your Library.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Stop sharing', style: 'destructive', onPress: onConfirm },
  ]);
}
