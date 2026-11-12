import { Stack } from 'expo-router';

export default function LibraryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: true }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="add" />
      <Stack.Screen name="add/[book]/[chapter]" />
      <Stack.Screen name="setup/[id]" />
      {/* Its grid scrolls sideways, so back stays on the edge. */}
      <Stack.Screen name="shared/[id]" options={{ fullScreenGestureEnabled: false }} />
    </Stack>
  );
}
