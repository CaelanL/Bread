/**
 * One-time explainer card surfaced after sign-in. Appears the first
 * time a user reaches an authenticated state on this device, IF they
 * haven't already been shown it (AsyncStorage flag) AND they're in
 * `undetermined` permission state (not granted, not denied).
 *
 * Two actions: Enable (runs the permission flow + initialize defaults)
 * or Maybe later (sets the dismissed flag, defers to the Q14 badge).
 *
 * Pre-checks getPermissionStatus() before rendering: if the user
 * previously enabled and reinstalled, we skip the card and silently
 * re-register the token on first foreground (handled in
 * syncForegroundState).
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  getPermissionStatus,
  initializeDefaults,
  requestPermission,
  registerDeviceToken,
  useNotificationPreferences,
  useUxFlagsStore,
} from '@/lib/notifications';

interface Props {
  /** Only consult this card after the auth flow has settled. */
  isAuthenticated: boolean;
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function Q1ExplainerCard({ isAuthenticated }: Props) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const q1Dismissed = useUxFlagsStore((s) => s.q1Dismissed);
  const flagsHydrated = useUxFlagsStore((s) => s.hydrated);
  const prefs = useNotificationPreferences();

  // iOS one-shots requestPermissionsAsync. Guard against double-tap
  // racing two calls — keeps the OS prompt single-track.
  const requesting = useRef(false);

  useEffect(() => {
    // Sign-out closes the card immediately — don't leave it hovering
    // over the auth screen.
    if (!isAuthenticated) {
      setVisible(false);
      return;
    }
    if (!flagsHydrated) return;
    if (q1Dismissed) return;

    let cancelled = false;
    (async () => {
      const status = await getPermissionStatus();
      if (cancelled) return;
      if (status === 'undetermined') {
        setVisible(true);
      } else {
        // Granted/provisional/denied — never show the card; just
        // mark dismissed so subsequent sessions skip the check.
        await useUxFlagsStore.getState().markQ1Dismissed();
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, flagsHydrated, q1Dismissed]);

  const handleEnable = async () => {
    if (requesting.current) return;
    requesting.current = true;
    setSubmitting(true);
    try {
      const status = await requestPermission();
      if (status === 'granted' || status === 'provisional') {
        await registerDeviceToken();
        // Only initialize if no row exists; second-device sign-in
        // already has prefs hydrated via app/_layout.tsx.
        if (!prefs) {
          await initializeDefaults(deviceTimezone());
        }
      }
      // On denied/undetermined, no row insert. Q14 badge picks them up.
      await useUxFlagsStore.getState().markQ1Dismissed();
    } finally {
      setSubmitting(false);
      requesting.current = false;
      setVisible(false);
    }
  };

  const handleMaybeLater = async () => {
    await useUxFlagsStore.getState().markQ1Dismissed();
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={handleMaybeLater}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.cardAlt }]}>
          <Text style={[styles.title, { color: colors.text }]}>Get review reminders</Text>
          <Text style={[styles.body, { color: colors.icon }]}>
            A daily nudge so verses you&apos;ve worked on don&apos;t slip away.
          </Text>
          <View style={styles.buttonStack}>
            <Pressable
              style={[styles.primary, { backgroundColor: colors.primary }, submitting && { opacity: 0.7 }]}
              onPress={handleEnable}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color={colors.white} />
                : <Text style={[styles.primaryText, { color: colors.white }]}>Enable notifications</Text>}
            </Pressable>
            <Pressable style={styles.secondary} onPress={handleMaybeLater} disabled={submitting}>
              <Text style={[styles.secondaryText, { color: colors.icon }]}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 20,
  },
  buttonStack: {
    gap: 8,
  },
  primary: {
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    padding: 14,
    alignItems: 'center',
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '500',
  },
});
