import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';
import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { NetworkProvider } from '@/lib/network';
import { NoInternetOverlay } from '@/components/ui/NoInternetOverlay';
import { ErrorToast } from '@/components/ui/ErrorToast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { clearSessionCache, getSessionCacheStats } from '@/lib/api/bible';
import { useAppStore } from '@/lib/store';
import {
  installDevTools as installNotifDevTools,
  registerDeepLinkHandler,
  replayColdStartTap,
  syncForegroundState,
  usePrefsStore,
} from '@/lib/notifications';

// Foreground notification handler — suppress everything while the app
// is foregrounded. Per the design doc: "I don't really care for
// notifications while in the app." Pushes still appear in iOS
// Notification Center if the user backgrounds before clearing.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Expose dev tools to console
if (__DEV__) {
  (global as any).clearCache = clearSessionCache;
  (global as any).cacheStats = getSessionCacheStats;
  installNotifDevTools();
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

  // Hydrate store and run migration when authenticated. Sequenced as
  // an inline async so a fast sign-out → sign-in cycle can't race the
  // clear against the next hydrate (would briefly surface the previous
  // user's prefs to Settings UI).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isAuthenticated) {
        useAppStore.getState().hydrate().catch((e) => {
          console.error('[App] Store hydration error:', e);
        });

        // Hydrate notification prefs (cache → server), then foreground
        // sync once (registers token if granted, resyncs TZ, fires
        // last-foregrounded heartbeat).
        try {
          await usePrefsStore.getState().hydrate();
          if (cancelled) return;
          await syncForegroundState();
        } catch (e) {
          console.error('[App] Notification hydration', e);
        }
      } else {
        useAppStore.getState().clear();

        // Clear local notification cache. Server-side device_tokens
        // row stays — ownership transfers via UPSERT when the next
        // user signs in (UNIQUE(expo_token)).
        try {
          await usePrefsStore.getState().clear();
        } catch {
          // best-effort
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Run foreground-sync each time the app comes back to active.
  // Idempotent + best-effort.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (prev.match(/inactive|background/) && next === 'active' && isAuthenticated) {
        syncForegroundState().catch(() => { /* best-effort */ });
      }
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  // Notification tap handler — registered once at app boot. Live taps
  // route immediately; cold-start tap is queued until auth + navigation
  // are ready (replayed in the next effect).
  useEffect(() => {
    const unsub = registerDeepLinkHandler();
    return unsub;
  }, []);

  // Replay any queued cold-start tap once the user is authenticated
  // and the navigator is mounted. Avoids pushing onto an unmounted
  // stack or routing past the auth gate.
  useEffect(() => {
    if (isAuthenticated && navigationState?.key) {
      replayColdStartTap();
    }
  }, [isAuthenticated, navigationState?.key]);

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
