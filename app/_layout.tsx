import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { SplashScreen, Stack, router, usePathname, useSegments, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import 'react-native-reanimated';
import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { AuthProvider, SPLASH_FAILSAFE_MS, useAuth } from '@/lib/auth';
import { NetworkProvider } from '@/lib/network';
import { NoInternetOverlay } from '@/components/ui/NoInternetOverlay';
import { ErrorToast } from '@/components/ui/ErrorToast';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Q1ExplainerCard } from '@/components/notifications/Q1ExplainerCard';
import { clearSessionCache, getSessionCacheStats } from '@/lib/api/bible';
import { perfMark } from '@/lib/api/dev-timing';
import { returnTracker } from '@/lib/resume';
import { settingsRead, useAppStore } from '@/lib/store';
import { claimInstallHandoff, clearPendingJoin, forgetInstallHandoff, readPendingJoin, stashPendingJoin } from '@/lib/shared/pending-join';
import { claimWelcome, markWelcomeShown, peekWelcome } from '@/lib/welcome';
import {
  installDevTools as installNotifDevTools,
  registerDeepLinkHandler,
  replayColdStartTap,
  syncForegroundState,
  useUxFlagsStore,
} from '@/lib/notifications';

perfMark('root');

// The splash stays up until the first frame has the color mode and either the session or a saved
// library to show (RootLayoutNav), so nothing flashes light or empty. Hidden regardless after the failsafe.
SplashScreen.preventAutoHideAsync().catch(() => { /* no splash module (web) */ });
setTimeout(() => SplashScreen.hide(), SPLASH_FAILSAFE_MS);

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

// The launch's profile read says whether the walkthrough was already seen, so a seen account
// makes no claim. With no profile read (offline), no claim this launch. A saved library's paint
// comes before the profile read, so this waits for the server's.
function claimAfterLoad(userId: string): Promise<boolean> {
  return new Promise<void>((resolve) => {
    if (useAppStore.getState().hydratedFrom === 'server') return resolve();
    const unsubscribe = useAppStore.subscribe(({ hydratedFrom }) => {
      if (hydratedFrom !== 'server') return;
      unsubscribe();
      resolve();
    });
  }).then(() => {
    const { profileLoaded, welcomeSeen } = useAppStore.getState();
    return profileLoaded && claimWelcome(userId, welcomeSeen);
  });
}

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { isAuthenticated, isLoading, sessionRestored, user } = useAuth();
  const userId = user?.id;
  const segments = useSegments();
  const pathname = usePathname();
  const navigationState = useRootNavigationState();
  // The stored user's saved library painted while the session restores (offline, or a slow token
  // refresh): show it rather than the spinner. Writes still wait for the session and fail visibly.
  const painted = useAppStore((state) => state.hydrated);

  // Handle navigation based on auth state
  useEffect(() => {
    if (!navigationState?.key || isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isResetPassword = segments[0] === 'reset-password';
    const isDevSignIn = segments[0] === 'dev-sign-in';

    if (!isAuthenticated && !inAuthGroup && !isResetPassword && !isDevSignIn) {
      // An invite link opened signed out joins after sign-in (effect below).
      const invite = pathname.match(/^\/join\/([^/]+)/)?.[1];
      if (invite) stashPendingJoin(invite).catch((e) => console.error('[join] Failed to keep the invite:', e));
      // Not authenticated and not on auth screen - redirect to sign in
      router.replace('/(auth)/sign-in');
    } else if (isAuthenticated && inAuthGroup) {
      // Authenticated but on auth screen - redirect to main app
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, pathname, navigationState?.key]);

  // After the gate above has sent a fresh sign-in to the tabs, open the invite stashed on the way in
  // (or, once per install, one handed off from the sendlabs.dev page across the App Store install),
  // over the Library, so the X and Join both land there. The reminders card is held before the
  // read, so it can't present first and be under (or closing under) the invite; JoinInvite then
  // holds it while mounted and releases it as it unmounts.
  // Waits for the tabs, so a redirect still settling (the sign-in gate, dev-sign-in's `next`) can't
  // replace the invite right after it's pushed.
  // With no invite, the 2.0 "What's new in Bread" walkthrough opens instead, once per account (see
  // lib/welcome.ts), holding the card the same way. After an invite this launch it makes no new claim,
  // but still shows one won before the invite landed (peekWelcome).
  const inTabs = segments[0] === '(tabs)';
  const sawInvite = useRef(false);
  if (segments[0] === 'join') sawInvite.current = true;
  useEffect(() => {
    if (!userId || !navigationState?.key || !inTabs) return;
    let settled = false;
    const flags = useUxFlagsStore.getState();
    flags.setInviteOpen(true);
    readPendingJoin()
      .then((kept) => kept ?? claimInstallHandoff(sessionRestored))
      .catch((e) => {
        console.error('[join] Failed to read the kept invite:', e);
        return null;
      })
      .then(async (invite) => {
        if (settled) return;
        if (!invite) {
          const welcome = sawInvite.current ? await peekWelcome(userId) : await claimAfterLoad(userId);
          if (settled) return;
          settled = true;
          if (welcome) {
            markWelcomeShown(userId);
            router.push('/welcome');
          } else {
            flags.setInviteOpen(false);
          }
          return;
        }
        settled = true;
        router.replace('/(tabs)/(library)');
        router.push(`/join/${invite}`);
        forgetInstallHandoff();
        clearPendingJoin().catch((e) => console.error('[join] Failed to clear the kept invite:', e));
      });
    return () => {
      // Still reading: this run won't push, so it lets go of the card.
      if (settled) return;
      settled = true;
      flags.setInviteOpen(false);
    };
  }, [userId, navigationState?.key, inTabs, sessionRestored]);

  // Foreground sync on every return: a quick one only checks the permission; the heartbeat waits
  // for RESUME_AWAY_MS away. Idempotent + best-effort.
  useEffect(() => {
    const sub = AppState.addEventListener('change', returnTracker((resumed) => {
      if (isAuthenticated) syncForegroundState({ resumed }).catch(() => { /* best-effort */ });
    }));
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

  const ready = !isLoading || painted;
  useEffect(() => {
    if (ready) settingsRead.then(() => SplashScreen.hide());
  }, [ready]);

  const colors = Colors[colorScheme ?? 'light'];
  const darkScreen = colorScheme === 'dark' || segments[0] === '(auth)' || segments[0] === 'reset-password';

  // Show loading spinner while checking auth
  if (isLoading && !painted) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false, fullScreenGestureEnabled: true }}>
        <Stack.Screen name="(auth)" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="reset-password" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="feedback" />
        <Stack.Screen name="collections/[slug]" />
        <Stack.Screen name="session" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="join/[code]" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="join/index" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="share/[id]" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="welcome" options={{ presentation: 'transparentModal', animation: 'fade', contentStyle: { backgroundColor: 'transparent' } }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
      <Q1ExplainerCard isAuthenticated={isAuthenticated} />
      <StatusBar style={darkScreen ? 'light' : 'dark'} />
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
