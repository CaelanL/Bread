import { Stack } from 'expo-router';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="home" />
      <Stack.Screen name="explore" />
      <Stack.Screen name="insights" />
    </Stack>
  );
}
