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
