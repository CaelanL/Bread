import { Stack } from 'expo-router';

export const unstable_settings = {
  anchor: 'home',
};

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: true }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="explore" />
      <Stack.Screen name="insights" />
    </Stack>
  );
}
