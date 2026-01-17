import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { migrateLocalDataToServer } from '@/lib/sync';
import { AuthProvider, useAuth } from '@/lib/auth';
import { NetworkProvider } from '@/lib/network';
import { NoInternetOverlay } from '@/components/ui/NoInternetOverlay';
import { ErrorToast } from '@/components/ui/ErrorToast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { clearSessionCache, getSessionCacheStats } from '@/lib/api/bible';
import { useAppStore } from '@/lib/store';

// Expose dev tools to console
if (__DEV__) {
  (global as any).clearCache = clearSessionCache;
  (global as any).cacheStats = getSessionCacheStats;
}

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  // Handle navigation based on auth state
  useEffect(() => {
    if (!navigationState?.key || isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isResetPassword = segments[0] === 'reset-password';

    if (!isAuthenticated && !inAuthGroup && !isResetPassword) {
      // Not authenticated and not on auth screen - redirect to sign in
      router.replace('/(auth)/sign-in');
    } else if (isAuthenticated && inAuthGroup) {
      // Authenticated but on auth screen - redirect to main app
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, navigationState?.key]);

  // Hydrate store and run migration when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      // Hydrate the store with user data
      useAppStore.getState().hydrate().catch((e) => {
        console.error('[App] Store hydration error:', e);
      });

      // Run migration
      migrateLocalDataToServer().catch((e) => {
        console.error('[App] Migration error:', e);
      });
    } else {
      // Clear store on logout
      useAppStore.getState().clear();
    }
  }, [isAuthenticated]);

  const colors = Colors[colorScheme ?? 'light'];

  // Show loading spinner while checking auth
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="session" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <NetworkProvider>
          <KeyboardProvider>
            <AuthProvider>
              <RootLayoutNav />
              <NoInternetOverlay />
              <ErrorToast />
            </AuthProvider>
          </KeyboardProvider>
        </NetworkProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
