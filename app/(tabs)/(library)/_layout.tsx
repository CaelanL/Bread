import { Stack } from 'expo-router';

export default function LibraryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="add" />
      <Stack.Screen name="add/[book]/[chapter]" />
      <Stack.Screen name="setup/[id]" />
      <Stack.Screen name="shared/[id]" />
    </Stack>
  );
}
