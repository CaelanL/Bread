// lib-ok: Holds an invite code from a signed-out link tap through sign-in, sign-up with email confirmation and an app kill.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_JOIN_KEY = 'shared_pending_join';

export async function stashPendingJoin(code: string) {
  await AsyncStorage.setItem(PENDING_JOIN_KEY, code);
}

export async function readPendingJoin(): Promise<string | null> {
  return AsyncStorage.getItem(PENDING_JOIN_KEY);
}

export async function clearPendingJoin() {
  await AsyncStorage.removeItem(PENDING_JOIN_KEY);
}
