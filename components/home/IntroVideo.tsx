import { useIsFocused } from '@react-navigation/native';
import { Audio, Video } from 'expo-av';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet } from 'react-native';

import { IntroVideoModal } from '@/components/ui/IntroVideoModal';
import { useAuth } from '@/lib/auth';
import { createIntroCoordinator } from '@/lib/intro/coordinator';
import { prepareIntroVideo } from '@/lib/intro/preparation';
import { canUseIntroFixture, introMediaForPreview } from '@/lib/intro/media';
import { useUxFlagsStore } from '@/lib/notifications';
import { useHydrated } from '@/lib/store';

export function IntroVideo({ blocked }: { blocked: boolean }) {
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
  const preload = useRef<Video>(null);
  const preparation = useRef(0);
  const preparationAbort = useRef<AbortController | null>(null);
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
      preparationAbort.current?.abort();
      const controller = new AbortController();
      preparationAbort.current = controller;
      const video = preload.current;
      if (!video || currentOwner.current !== owner) throw new Error('Player unavailable.');
      await prepareIntroVideo(video, source, controller.signal,
        () => request === preparation.current && currentOwner.current === owner && preload.current === video);
    },
    configureAudio: () => Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: false }),
    show() { if (currentOwner.current === owner) setModalOwner(owner); },
    close() {
      if (currentOwner.current !== owner) return;
      preparation.current++;
      preparationAbort.current?.abort();
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

  return (
    <>
      {media.playback !== null && session && (
        <Video key={`preload:${session.user.id}`} ref={preload} style={styles.preloader} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      )}
      <IntroVideoModal key={modalOwner === owner ? `modal:${owner}` : 'closed'} media={media} visible={modalOwner === owner} inactive={appState === 'inactive'} onClose={() => coordinator?.cancel()} />
    </>
  );
}

const styles = StyleSheet.create({
  preloader: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
