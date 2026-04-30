/**
 * Notifications configuration page.
 *
 * Reached from Settings. All edits live in local *draft* state until
 * the user taps Save — that protects users from accidentally flipping
 * a toggle and immediately altering server state. Back without
 * unsaved changes pops; back with unsaved changes prompts a
 * Discard/Cancel confirm.
 *
 * Permission flow nuances:
 *
 *   • iOS one-shots `requestPermissionsAsync()` — only `undetermined`
 *     triggers the OS dialog. So flipping the master toggle from OFF
 *     to ON when permission is `undetermined` MUST call
 *     requestPermission() inline (not deferred to Save), because by
 *     Save-time we'd no longer be in the only state where the dialog
 *     can fire.
 *
 *   • `denied` is terminal in-app. Master ON in this state opens iOS
 *     Settings; we don't draft `masterEnabled=true` because the
 *     server write would be honored but no push could ever arrive.
 *
 *   • Permission can change between page-open and Save (user goes to
 *     iOS Settings mid-session). We re-probe on every AppState
 *     `active` and again at Save time.
 *
 * Source-of-truth model:
 *   prefs (server, via Zustand) ─── seed ───▶ draft (local state)
 *                                              │
 *                                              │ Save
 *                                              ▼
 *                                       patch(diff) → server
 */

import {
  NotificationInfoButton,
  NotificationInfoModal,
} from '@/components/notifications/NotificationInfoModal';
import { NotificationCadenceModal } from '@/components/settings/NotificationCadenceModal';
import { NotificationTimeModal } from '@/components/settings/NotificationTimeModal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  defaultPreferences,
  getPermissionStatus,
  initializeDefaults,
  openOsSettings,
  patchPreferences,
  registerDeviceToken,
  requestPermission,
  useNotificationPreferences,
  usePrefsStore,
  type Cadence,
  type IosPermissionStatus,
  type NotificationPreferences,
} from '@/lib/notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatTime(hour24: number, minute: number): string {
  let h12 = hour24 % 12;
  if (h12 === 0) h12 = 12;
  const period = hour24 < 12 ? 'AM' : 'PM';
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

function formatCadence(cadence: Cadence, weekday: number | null): string {
  if (cadence === 'daily') return 'Daily';
  if (weekday == null) return 'Weekly';
  return `Every ${WEEKDAY_LABELS[weekday]}`;
}

/** Shallow equal across all keys we draft. Excludes `timezone` — that
 *  field is owned by foreground sync, not this page. */
function isDirty(a: NotificationPreferences, b: NotificationPreferences): boolean {
  return (
    a.masterEnabled !== b.masterEnabled ||
    a.reviewsEnabled !== b.reviewsEnabled ||
    a.reviewsCadence !== b.reviewsCadence ||
    a.reviewsWeekday !== b.reviewsWeekday ||
    a.reviewsHour !== b.reviewsHour ||
    a.reviewsMinute !== b.reviewsMinute ||
    a.inProgressEnabled !== b.inProgressEnabled ||
    a.inProgressCadence !== b.inProgressCadence ||
    a.inProgressWeekday !== b.inProgressWeekday ||
    a.inProgressHour !== b.inProgressHour ||
    a.inProgressMinute !== b.inProgressMinute
  );
}

/** Diff for PATCH — only the keys that changed. */
function buildPatch(
  current: NotificationPreferences,
  draft: NotificationPreferences,
): Partial<NotificationPreferences> {
  const out: Partial<NotificationPreferences> = {};
  if (current.masterEnabled !== draft.masterEnabled) out.masterEnabled = draft.masterEnabled;
  if (current.reviewsEnabled !== draft.reviewsEnabled) out.reviewsEnabled = draft.reviewsEnabled;
  // cadence ⇄ weekday is a coupled pair under the schema CHECK; if
  // either changed, send both so the server never sees a transient
  // inconsistent state.
  if (
    current.reviewsCadence !== draft.reviewsCadence ||
    current.reviewsWeekday !== draft.reviewsWeekday
  ) {
    out.reviewsCadence = draft.reviewsCadence;
    out.reviewsWeekday = draft.reviewsWeekday;
  }
  if (current.reviewsHour !== draft.reviewsHour) out.reviewsHour = draft.reviewsHour;
  if (current.reviewsMinute !== draft.reviewsMinute) out.reviewsMinute = draft.reviewsMinute;
  if (current.inProgressEnabled !== draft.inProgressEnabled) {
    out.inProgressEnabled = draft.inProgressEnabled;
  }
  if (
    current.inProgressCadence !== draft.inProgressCadence ||
    current.inProgressWeekday !== draft.inProgressWeekday
  ) {
    out.inProgressCadence = draft.inProgressCadence;
    out.inProgressWeekday = draft.inProgressWeekday;
  }
  if (current.inProgressHour !== draft.inProgressHour) out.inProgressHour = draft.inProgressHour;
  if (current.inProgressMinute !== draft.inProgressMinute) {
    out.inProgressMinute = draft.inProgressMinute;
  }
  return out;
}

export default function NotificationsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const prefs = useNotificationPreferences();

  // Snapshot of the server prefs the page was seeded with. Compared
  // against `draft` to compute dirtiness and the Save patch.
  const [baseline, setBaseline] = useState<NotificationPreferences>(() =>
    prefs ?? defaultPreferences(deviceTimezone()),
  );
  const [draft, setDraft] = useState<NotificationPreferences>(() =>
    prefs ?? defaultPreferences(deviceTimezone()),
  );

  // If prefs hydrate AFTER mount (cold-start race), reseed *only if
  // the user hasn't started editing*. If they have, only update
  // baseline (so dirty-detection compares draft against the real
  // server row, not the empty default). Either way, this fires
  // exactly once — subsequent prefs changes are our own optimistic
  // Saves and shouldn't reseed.
  const hasSeededFromServer = useRef(prefs !== null);
  useEffect(() => {
    if (!prefs) return;
    if (hasSeededFromServer.current) return;
    hasSeededFromServer.current = true;
    setBaseline(prefs);
    setDraft((current) => (isDirty(baseline, current) ? current : prefs));
    // Intentionally exclude `baseline`/`draft` from deps. We only
    // want this to fire when prefs transitions from null to a value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs]);

  const [permission, setPermission] = useState<IosPermissionStatus>('undetermined');
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [saving, setSaving] = useState(false);

  // iOS one-shots requestPermissionsAsync — guard against double-tap
  // racing two calls.
  const requesting = useRef(false);

  const refreshPermission = useCallback(async () => {
    const status = await getPermissionStatus();
    setPermission(status);
  }, []);

  useEffect(() => {
    refreshPermission();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  const dirty = isDirty(baseline, draft);
  const isGranted = permission === 'granted' || permission === 'provisional';
  const showRest = isGranted && draft.masterEnabled;

  // Modal state
  const [reviewsTimeOpen, setReviewsTimeOpen] = useState(false);
  const [reviewsCadenceOpen, setReviewsCadenceOpen] = useState(false);
  const [inProgressTimeOpen, setInProgressTimeOpen] = useState(false);
  const [inProgressCadenceOpen, setInProgressCadenceOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const handleMasterToggle = async (next: boolean) => {
    if (requesting.current) return;

    if (permission === 'undetermined') {
      // Defensive: if the Switch ever surfaces value=true here (stale
      // cache after permission was reset OOB), tapping OFF should
      // just draft OFF, not re-fire the request flow.
      if (next === false) {
        setDraft((d) => ({ ...d, masterEnabled: false }));
        return;
      }
      // iOS dialog can only fire from `undetermined` — so we have to
      // use the live attempt now rather than draft it.
      requesting.current = true;
      setRequestingPermission(true);
      try {
        const status = await requestPermission();
        setPermission(status);
        if (status === 'granted' || status === 'provisional') {
          await registerDeviceToken();
          // Draft master ON. The actual server INSERT (if no row yet)
          // happens at Save time.
          setDraft((d) => ({ ...d, masterEnabled: true }));
        }
        // On denied, draft stays as-is (off). User can still tweak
        // every other field; Save will surface the permission gap.
      } finally {
        setRequestingPermission(false);
        requesting.current = false;
      }
      return;
    }

    if (permission === 'denied') {
      await openOsSettings();
      return;
    }

    // granted/provisional — pure draft write.
    setDraft((d) => ({ ...d, masterEnabled: next }));
  };

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Re-read prefs from the live store. The closure's `prefs` was
      // captured at last render — if hydrate completed between then
      // and now, the closure is stale. Branching on stale null would
      // run the INSERT path against an existing row → PRIMARY KEY
      // conflict.
      const livePrefs = usePrefsStore.getState().prefs;

      // Re-probe permission. If denied and master is drafted ON,
      // there's nothing useful we can do server-side — the row would
      // be `master_enabled=true` but iOS would block every push. Bail.
      const status = await getPermissionStatus();
      setPermission(status);
      const granted = status === 'granted' || status === 'provisional';
      if (draft.masterEnabled && !granted) {
        Alert.alert(
          'Allow notifications first',
          'Open iOS Settings to allow notifications for Bread, then come back to save.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => openOsSettings() },
          ],
        );
        return;
      }

      // Path A: no server row yet. INSERT defaults, then PATCH the
      // remaining diff. The two-step is so we don't bake an INSERT
      // shape that depends on draft staying in sync with the
      // server-side default row.
      if (!livePrefs) {
        const inserted = await initializeDefaults(draft.timezone || deviceTimezone());
        if (!inserted) {
          Alert.alert('Save failed', 'Could not save notification settings. Please try again.');
          return;
        }
        const patch = buildPatch(inserted, draft);
        if (Object.keys(patch).length > 0) {
          const ok = await patchPreferences(patch);
          if (!ok) {
            // Partial save: the INSERT landed but the PATCH didn't.
            // Update baseline to the inserted row so the user sees
            // "what's still pending" via the dirty indicator and can
            // retry. Mark the seeded ref so the late-hydrate effect
            // doesn't fire and clobber draft on the next render.
            setBaseline(inserted);
            hasSeededFromServer.current = true;
            Alert.alert('Save partially failed', 'Some settings didn’t save. Please try again.');
            return;
          }
        }
        const finalPrefs = usePrefsStore.getState().prefs ?? inserted;
        setBaseline(finalPrefs);
        setDraft(finalPrefs);
        router.back();
        return;
      }

      // Path B: existing row. Compute diff against the live baseline.
      // `baseline` is whatever we last seeded from — if hydrate
      // completed mid-session, the late-hydrate effect already
      // updated it.
      const patch = buildPatch(baseline, draft);
      if (Object.keys(patch).length === 0) {
        router.back();
        return;
      }
      const ok = await patchPreferences(patch);
      if (!ok) {
        Alert.alert('Save failed', 'Could not save notification settings. Please try again.');
        return;
      }
      const finalPrefs = usePrefsStore.getState().prefs ?? draft;
      setBaseline(finalPrefs);
      setDraft(finalPrefs);
      router.back();
    } finally {
      setSaving(false);
    }
  }, [baseline, draft, saving]);

  const handleBack = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(
      'Discard changes?',
      'Your notification settings haven’t been saved.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
      ],
    );
  }, [dirty]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.headerButton} hitSlop={12}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
          <Text style={[styles.headerBackLabel, { color: colors.text }]}>Settings</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        <Pressable
          onPress={handleSave}
          disabled={!dirty || saving}
          style={styles.headerButton}
          hitSlop={12}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <Text
              style={[
                styles.headerSaveLabel,
                { color: dirty ? colors.tint : colors.icon },
                !dirty && { opacity: 0.5 },
              ]}
            >
              Save
            </Text>
          )}
        </Pressable>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* MASTER */}
        <View style={styles.section}>
          <View
            style={[
              styles.sectionContent,
              { backgroundColor: colors.card, borderColor: colors.borderLight },
            ]}
          >
            {permission === 'denied' ? (
              <Pressable onPress={() => handleMasterToggle(false)}>
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                      <IconSymbol name="bell.fill" size={20} color={colors.tint} />
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={[styles.label, { color: colors.text }]}>Notifications</Text>
                      <Text style={[styles.description, { color: colors.icon }]}>
                        Enable in iOS Settings
                      </Text>
                    </View>
                  </View>
                  <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                </View>
              </Pressable>
            ) : (
              <View style={[styles.row, { borderBottomWidth: 0 }]}>
                <View style={styles.rowLeft}>
                  <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                    <IconSymbol name="bell.fill" size={20} color={colors.tint} />
                  </View>
                  <View style={styles.labelContainer}>
                    <Text style={[styles.label, { color: colors.text }]}>Notifications</Text>
                    <Text style={[styles.description, { color: colors.icon }]}>
                      {permission === 'undetermined'
                        ? 'Tap to allow review reminders'
                        : draft.masterEnabled
                        ? 'Pause without losing your setup'
                        : 'All reminders paused'}
                    </Text>
                  </View>
                </View>
                {requestingPermission ? (
                  <ActivityIndicator size="small" color={colors.tint} />
                ) : (
                  <Switch
                    value={isGranted && draft.masterEnabled}
                    onValueChange={handleMasterToggle}
                    trackColor={{ false: colors.borderLight, true: colors.primary }}
                  />
                )}
              </View>
            )}
          </View>
        </View>

        {showRest && (
          <>
            {/* REVIEW REMINDERS */}
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Text style={[styles.sectionTitle, { color: colors.icon }]}>REVIEW REMINDERS</Text>
                <NotificationInfoButton onPress={() => setInfoOpen(true)} />
              </View>
              <View
                style={[
                  styles.sectionContent,
                  { backgroundColor: colors.card, borderColor: colors.borderLight },
                ]}
              >
                <View
                  style={[
                    styles.row,
                    {
                      borderBottomWidth: draft.reviewsEnabled ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor: colors.borderLight,
                    },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                      <IconSymbol name="checkmark.circle.fill" size={20} color={colors.tint} />
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={[styles.label, { color: colors.text }]}>Enabled</Text>
                    </View>
                  </View>
                  <Switch
                    value={draft.reviewsEnabled}
                    onValueChange={(next) => setDraft((d) => ({ ...d, reviewsEnabled: next }))}
                    trackColor={{ false: colors.borderLight, true: colors.primary }}
                  />
                </View>

                {draft.reviewsEnabled && (
                  <>
                    <Pressable onPress={() => setReviewsCadenceOpen(true)}>
                      <View
                        style={[
                          styles.row,
                          {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: colors.borderLight,
                          },
                        ]}
                      >
                        <View style={styles.rowLeft}>
                          <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                            <IconSymbol name="calendar" size={20} color={colors.tint} />
                          </View>
                          <View style={styles.labelContainer}>
                            <Text style={[styles.label, { color: colors.text }]}>Cadence</Text>
                          </View>
                        </View>
                        <Text style={[styles.rowValue, { color: colors.icon }]}>
                          {formatCadence(draft.reviewsCadence, draft.reviewsWeekday)}
                        </Text>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                      </View>
                    </Pressable>

                    <Pressable onPress={() => setReviewsTimeOpen(true)}>
                      <View style={[styles.row, { borderBottomWidth: 0 }]}>
                        <View style={styles.rowLeft}>
                          <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                            <IconSymbol name="clock.fill" size={20} color={colors.tint} />
                          </View>
                          <View style={styles.labelContainer}>
                            <Text style={[styles.label, { color: colors.text }]}>Time</Text>
                          </View>
                        </View>
                        <Text style={[styles.rowValue, { color: colors.icon }]}>
                          {formatTime(draft.reviewsHour, draft.reviewsMinute)}
                        </Text>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                      </View>
                    </Pressable>
                  </>
                )}
              </View>
            </View>

            {/* IN-PROGRESS NUDGE */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.icon }]}>IN-PROGRESS NUDGE</Text>
              <View
                style={[
                  styles.sectionContent,
                  { backgroundColor: colors.card, borderColor: colors.borderLight },
                ]}
              >
                <View
                  style={[
                    styles.row,
                    {
                      borderBottomWidth: draft.inProgressEnabled ? StyleSheet.hairlineWidth : 0,
                      borderBottomColor: colors.borderLight,
                    },
                  ]}
                >
                  <View style={styles.rowLeft}>
                    <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                      <IconSymbol name="hourglass" size={20} color={colors.tint} />
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={[styles.label, { color: colors.text }]}>Enabled</Text>
                    </View>
                  </View>
                  <Switch
                    value={draft.inProgressEnabled}
                    onValueChange={(next) => setDraft((d) => ({ ...d, inProgressEnabled: next }))}
                    trackColor={{ false: colors.borderLight, true: colors.primary }}
                  />
                </View>

                {draft.inProgressEnabled && (
                  <>
                    <Pressable onPress={() => setInProgressCadenceOpen(true)}>
                      <View
                        style={[
                          styles.row,
                          {
                            borderBottomWidth: StyleSheet.hairlineWidth,
                            borderBottomColor: colors.borderLight,
                          },
                        ]}
                      >
                        <View style={styles.rowLeft}>
                          <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                            <IconSymbol name="calendar" size={20} color={colors.tint} />
                          </View>
                          <View style={styles.labelContainer}>
                            <Text style={[styles.label, { color: colors.text }]}>Cadence</Text>
                          </View>
                        </View>
                        <Text style={[styles.rowValue, { color: colors.icon }]}>
                          {formatCadence(draft.inProgressCadence, draft.inProgressWeekday)}
                        </Text>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                      </View>
                    </Pressable>

                    <Pressable onPress={() => setInProgressTimeOpen(true)}>
                      <View style={[styles.row, { borderBottomWidth: 0 }]}>
                        <View style={styles.rowLeft}>
                          <View style={[styles.iconContainer, { backgroundColor: colors.cardAlt }]}>
                            <IconSymbol name="clock.fill" size={20} color={colors.tint} />
                          </View>
                          <View style={styles.labelContainer}>
                            <Text style={[styles.label, { color: colors.text }]}>Time</Text>
                          </View>
                        </View>
                        <Text style={[styles.rowValue, { color: colors.icon }]}>
                          {formatTime(draft.inProgressHour, draft.inProgressMinute)}
                        </Text>
                        <IconSymbol name="chevron.right" size={16} color={colors.icon} />
                      </View>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Modals — write to draft only */}
      <NotificationTimeModal
        visible={reviewsTimeOpen}
        title="Review reminder time"
        initialHour={draft.reviewsHour}
        initialMinute={draft.reviewsMinute}
        onSave={(hour24, minute) =>
          setDraft((d) => ({ ...d, reviewsHour: hour24, reviewsMinute: minute }))
        }
        onClose={() => setReviewsTimeOpen(false)}
      />
      <NotificationCadenceModal
        visible={reviewsCadenceOpen}
        initialCadence={draft.reviewsCadence}
        initialWeekday={draft.reviewsWeekday}
        onSave={(cadence, weekday) =>
          setDraft((d) => ({ ...d, reviewsCadence: cadence, reviewsWeekday: weekday }))
        }
        onClose={() => setReviewsCadenceOpen(false)}
      />
      <NotificationTimeModal
        visible={inProgressTimeOpen}
        title="In-progress nudge time"
        initialHour={draft.inProgressHour}
        initialMinute={draft.inProgressMinute}
        onSave={(hour24, minute) =>
          setDraft((d) => ({ ...d, inProgressHour: hour24, inProgressMinute: minute }))
        }
        onClose={() => setInProgressTimeOpen(false)}
      />
      <NotificationCadenceModal
        visible={inProgressCadenceOpen}
        initialCadence={draft.inProgressCadence}
        initialWeekday={draft.inProgressWeekday}
        onSave={(cadence, weekday) =>
          setDraft((d) => ({ ...d, inProgressCadence: cadence, inProgressWeekday: weekday }))
        }
        onClose={() => setInProgressCadenceOpen(false)}
      />
      <NotificationInfoModal visible={infoOpen} onClose={() => setInfoOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 80,
  },
  headerBackLabel: {
    fontSize: 16,
    marginLeft: 2,
  },
  headerSaveLabel: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    gap: 24,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginLeft: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 12,
  },
  sectionContent: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  labelContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
  rowValue: {
    fontSize: 15,
    marginRight: 8,
    fontVariant: ['tabular-nums'],
  },
});
