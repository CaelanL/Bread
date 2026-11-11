import { useIsFocused } from '@react-navigation/native';
import { Audio, Video } from 'expo-av';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { IntroVideoModal } from '@/components/ui/IntroVideoModal';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/lib/auth';
import { createIntroCoordinator } from '@/lib/intro/coordinator';
import { canUseIntroFixture, introMediaForPreview } from '@/lib/intro/media';
import { useUxFlagsStore } from '@/lib/notifications';
import { useHydrated } from '@/lib/store';

export function IntroVideo({ blocked }: { blocked: boolean }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  const focused = useIsFocused();
  const hydrated = useHydrated();
  const { session } = useAuth();
  const { introFixture } = useLocalSearchParams<{ introFixture?: string }>();
  const flagsHydrated = useUxFlagsStore((state) => state.hydrated);
  const q1Dismissed = useUxFlagsStore((state) => state.q1Dismissed);
  const q1Presented = useUxFlagsStore((state) => state.q1Presented);
  const [appState, setAppState] = useState(AppState.currentState);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const accountId = session?.user.id;
  const [modalOwner, setModalOwner] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [manualError, setManualError] = useState(false);
  const preload = useRef<Video>(null);
  const preparation = useRef(0);
  const media = useMemo(() => {
    const fixture = canUseIntroFixture(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL) && introFixture === 'sample'
      ? require('@/assets/video/intro-fixture.mp4') : 0;
    return introMediaForPreview(__DEV__, process.env.EXPO_PUBLIC_SUPABASE_URL, introFixture, fixture);
  }, [introFixture]);
  const owner = `${session?.user.id ?? ''}:${media.id}:${media.playback ?? ''}`;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const eligible = focused && appState === 'active' && hydrated && !!session && !blocked && flagsHydrated && q1Dismissed && !q1Presented;
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;

  const player = useMemo(() => ({
    async prepare(source: string | number) {
      const request = ++preparation.current;
      const video = preload.current;
      if (!video || currentOwner.current !== owner) throw new Error('Player unavailable.');
      setPreparing(true);
      try {
        await video.unloadAsync();
        if (request !== preparation.current || currentOwner.current !== owner) throw new Error('Playback canceled.');
        const status = await video.loadAsync(typeof source === 'number' ? source : { uri: source }, { shouldPlay: false, isMuted: true });
        if (!status.isLoaded || request !== preparation.current || currentOwner.current !== owner) throw new Error('Media unavailable.');
      } finally {
        if (request === preparation.current && currentOwner.current === owner) setPreparing(false);
      }
    },
    configureAudio: () => Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: false, staysActiveInBackground: false }),
    show() { if (currentOwner.current === owner) setModalOwner(owner); },
    close() {
      if (currentOwner.current !== owner) return;
      preparation.current++;
      setPreparing(false);
      setModalOwner(null);
      void preload.current?.unloadAsync().catch(() => {});
    },
  }), [owner]);
  const coordinator = useMemo(() => accountId
    ? createIntroCoordinator(accountId, () => sessionRef.current, media, player, () => eligibleRef.current && currentOwner.current === owner)
    : null, [accountId, media, player, owner]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setAppState(state));
    return () => listener.remove();
  }, []);
  useEffect(() => () => coordinator?.cancel(), [coordinator]);
  useEffect(() => {
    if (!focused || appState === 'background' || !hydrated || !accountId || blocked || !flagsHydrated || !q1Dismissed || q1Presented) coordinator?.cancel();
    else if (appState === 'active') void coordinator?.attempt();
  }, [focused, appState, hydrated, accountId, blocked, flagsHydrated, q1Dismissed, q1Presented, coordinator]);

  const watch = async () => {
    setManualError(false);
    if (!media.playback) {
      try { await Linking.openURL(media.sourceUrl); }
      catch { setManualError(true); }
      return;
    }
    const shown = await coordinator?.replay();
    if (!shown && currentOwner.current === owner && eligibleRef.current) setManualError(true);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.row}>
        <View style={[styles.symbol, { backgroundColor: colors.primaryLight }]}>
          <IconSymbol name="play.fill" size={20} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.text }]}>Why memorize Scripture?</Text>
          <Text style={[styles.credit, { color: colors.icon }]}>{media.credit}</Text>
        </View>
      </View>
      <Pressable
        testID="intro-watch"
        accessibilityRole="button"
        disabled={preparing}
        onPress={() => void watch()}
        style={({ pressed }) => [styles.watch, { opacity: preparing ? 0.6 : 1, backgroundColor: colors.cardAlt, transform: [{ scale: pressed && !preparing ? Motion.pressScale : 1 }] }]}
      >
        {preparing ? <ActivityIndicator color={colors.icon} size="small" /> : <IconSymbol name={media.playback ? 'play.fill' : 'arrow.up.right'} size={15} color={colors.text} />}
        <Text style={[styles.watchText, { color: colors.text }]}>{preparing ? 'Preparing video…' : media.playback ? 'Watch video' : 'Watch on Desiring God'}</Text>
      </Pressable>
      {manualError && <Text style={[styles.error, { color: colors.icon }]}>Video unavailable. Please try again later.</Text>}
      {media.playback !== null && session && (
        <Video key={`preload:${owner}`} ref={preload} style={styles.preloader} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      )}
      <IntroVideoModal key={modalOwner === owner ? `modal:${owner}` : 'closed'} media={media} visible={modalOwner === owner} inactive={appState === 'inactive'} onClose={() => coordinator?.cancel()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 18, gap: 14, borderRadius: Radius.huge },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  symbol: { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, gap: 5 },
  title: { fontFamily: Fonts.serif, fontSize: 21, fontWeight: '600' },
  credit: { fontSize: 13 },
  watch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 16, borderRadius: Radius.full },
  watchText: { fontSize: 14, fontWeight: '600' },
  error: { fontSize: 13 },
  preloader: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
