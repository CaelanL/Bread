import { useEventListener } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Motion, Radius } from '@/constants/theme';
import { createIntroInterruption } from '@/lib/intro/interruption';
import { introCaption, type IntroMedia } from '@/lib/intro/media';
import { playbackClock, playbackFraction, seekPosition } from '@/lib/intro/scrub';

export function IntroVideoModal({ media, visible, inactive, onClose }: {
  media: IntroMedia;
  visible: boolean;
  inactive: boolean;
  onClose: () => void;
}) {
  if (!visible || !media.playback) return null;
  return <IntroVideoPlayer media={media} playback={media.playback} inactive={inactive} onClose={onClose} />;
}

// Mounted only while presented, so no native player exists otherwise.
function IntroVideoPlayer({ media, playback, inactive, onClose }: {
  media: IntroMedia;
  playback: string | number;
  inactive: boolean;
  onClose: () => void;
}) {
  const colors = Colors.dark;
  const insets = useSafeAreaInsets();
  const source = typeof playback === 'number' ? playback : { uri: playback };
  const player = useVideoPlayer(source, (created) => {
    created.loop = false;
    created.timeUpdateEventInterval = 0.25;
    // Other audio keeps playing, as it always has under the intro; the default 'auto' would interrupt it.
    created.audioMixingMode = 'mixWithOthers';
    created.play();
  });
  const interruption = useRef<ReturnType<typeof createIntroInterruption> | null>(null);
  useEffect(() => {
    const current = createIntroInterruption({
      pause: async () => player.pause(),
      play: async () => player.play(),
    });
    interruption.current = current;
    return () => current.dispose();
  }, [player]);
  useEffect(() => {
    void interruption.current?.setInactive(inactive).catch(() => {});
  }, [inactive]);
  const active = useRef(true);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState(false);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const track = useRef({ left: 0, width: 0, target: null as number | null });
  const [glyph, setGlyph] = useState<'play.fill' | 'pause.fill'>('pause.fill');
  const glyphOpacity = useSharedValue(0);
  const glyphStyle = useAnimatedStyle(() => ({ opacity: glyphOpacity.value }));

  useEventListener(player, 'statusChange', ({ status }) => {
    if (!active.current) return;
    if (status === 'readyToPlay') { setLoaded(true); setDuration(player.duration * 1000); }
    else if (status === 'error') setError(true);
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => {
    if (!active.current) return;
    void interruption.current?.onPlaying(isPlaying).catch(() => {});
    setPlaying(isPlaying);
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (active.current) setPosition(currentTime * 1000);
  });
  useEventListener(player, 'playToEnd', () => {
    if (active.current) setFinished(true);
  });
  // Events sent before the listeners above subscribed are lost, so read the player once they are.
  useEffect(() => {
    if (player.status === 'readyToPlay') { setLoaded(true); setDuration(player.duration * 1000); }
    else if (player.status === 'error') setError(true);
    void interruption.current?.onPlaying(player.playing).catch(() => {});
    setPlaying(player.playing);
  }, [player]);

  const close = () => {
    active.current = false;
    interruption.current?.dispose();
    player.pause();
    onClose();
  };
  const toggle = async () => {
    try {
      if (error) {
        setError(false); setLoaded(false);
        await player.replaceAsync(source);
        player.play();
        return;
      }
      setGlyph(playing && !finished ? 'pause.fill' : 'play.fill');
      glyphOpacity.value = withSequence(
        withTiming(1, { duration: Motion.pressMs }),
        withDelay(Motion.expandMs, withTiming(0, { duration: Motion.expandMs })),
      );
      if (finished) { setFinished(false); player.replay(); }
      else if (playing) player.pause();
      else player.play();
    } catch { setError(true); }
  };
  const canScrub = loaded && !error && duration > 0;
  const drag = (event: GestureResponderEvent) => {
    track.current.target = seekPosition((event.nativeEvent.pageX - track.current.left) / track.current.width, duration);
    setScrub(track.current.target);
  };
  const seek = () => {
    const target = track.current.target;
    track.current.target = null;
    if (target === null) return;
    try {
      // seekTolerance defaults to exact.
      player.currentTime = target / 1000;
      setPosition(target);
      if (target < duration) setFinished(false);
    } catch { /* The bar returns to the actual position. */ }
    setScrub(null);
  };

  const shown = scrub ?? position;
  const fraction = `${playbackFraction(shown, duration) * 100}%` as const;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <StatusBar style="light" />
      <View testID="intro-video-modal" style={[styles.overlay, { backgroundColor: colors.background, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.topRow}>
          <Text style={[styles.credit, { color: colors.icon }]}>{media.credit}</Text>
          <Pressable testID="intro-close" accessibilityRole="button" accessibilityLabel="Close video" onPress={close} style={styles.close}>
            <IconSymbol name="xmark" size={24} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.main}>
          <Text style={[styles.headline, { color: colors.text }]}>{media.headline}</Text>
          {media.fixture && <Text style={[styles.fixture, { color: colors.icon }]}>Development fixture · plays with the silent switch on</Text>}
          <View style={styles.player}>
            <Pressable
              testID="intro-video-surface"
              accessibilityRole="button"
              accessibilityLabel="Video"
              accessibilityHint="Pauses or plays the video"
              disabled={!loaded && !error}
              onPress={() => void toggle()}
              style={[styles.frame, { backgroundColor: colors.card }]}
            >
              <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
                contentFit="contain"
                nativeControls={false}
              />
              {!loaded && !error && <ActivityIndicator color={colors.primary} />}
              <Animated.View pointerEvents="none" style={[styles.glyph, { backgroundColor: colors.overlay }, glyphStyle]}>
                <IconSymbol name={glyph} size={30} color={colors.white} />
              </Animated.View>
            </Pressable>
            <View style={styles.bar}>
              <Pressable
                testID="intro-play-pause"
                accessibilityRole="button"
                accessibilityLabel={finished || error ? 'Replay video' : playing ? 'Pause video' : 'Play video'}
                disabled={!loaded && !error}
                onPress={() => void toggle()}
                style={({ pressed }) => [styles.control, { opacity: !loaded && !error ? 0.5 : 1, transform: [{ scale: pressed && loaded ? Motion.pressScale : 1 }] }]}
              >
                <IconSymbol name={finished || error ? 'arrow.counterclockwise' : playing ? 'pause.fill' : 'play.fill'} size={20} color={colors.text} />
              </Pressable>
              <Text testID="intro-progress" style={[styles.progress, { color: colors.text }]}>{playbackClock(shown)}</Text>
              <View
                testID="intro-scrubber"
                accessible
                accessibilityLabel="Video position"
                accessibilityValue={{ text: `${playbackClock(shown)} of ${playbackClock(duration)}` }}
                style={styles.track}
                onLayout={(event) => { track.current.width = event.nativeEvent.layout.width; }}
                onStartShouldSetResponder={() => canScrub}
                onMoveShouldSetResponder={() => canScrub}
                onResponderTerminationRequest={() => false}
                onResponderGrant={(event) => { track.current.left = event.nativeEvent.pageX - event.nativeEvent.locationX; drag(event); }}
                onResponderMove={drag}
                onResponderRelease={seek}
                onResponderTerminate={seek}
              >
                <View pointerEvents="none" style={[styles.rail, { backgroundColor: colors.border }]}>
                  <View style={[styles.fill, { width: fraction, backgroundColor: colors.primary }]} />
                </View>
                <View pointerEvents="none" style={[scrub === null ? styles.thumb : styles.thumbActive, { left: fraction, backgroundColor: colors.primary }]} />
              </View>
              <Text style={[styles.progress, { color: colors.icon }]}>{playbackClock(duration)}</Text>
            </View>
          </View>
          <Text testID="intro-caption" style={[styles.caption, { color: colors.text }]} accessibilityLiveRegion="polite">
            {error ? 'This video could not load. You can close it or try replaying.' : introCaption(media, shown)}
          </Text>
        </View>
        <Text style={[styles.footnote, { color: colors.icon }]}>Start with one verse. Keep it close.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  credit: { fontSize: 13, flex: 1 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, justifyContent: 'center', gap: 20 },
  headline: { fontFamily: Fonts.serif, fontWeight: '600', fontSize: 34 },
  fixture: { fontSize: 12 },
  frame: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  player: { gap: 4 },
  glyph: { position: 'absolute', width: 64, height: 64, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  control: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 44, justifyContent: 'center' },
  rail: { height: 4, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: '100%' },
  thumb: { position: 'absolute', top: 15, width: 14, height: 14, marginLeft: -7, borderRadius: Radius.full },
  thumbActive: { position: 'absolute', top: 12, width: 20, height: 20, marginLeft: -10, borderRadius: Radius.full },
  caption: { fontSize: 18, lineHeight: 27, textAlign: 'center', minHeight: 54 },
  progress: { fontSize: 13, fontVariant: ['tabular-nums'] },
  footnote: { textAlign: 'center', fontSize: 13, marginTop: 20 },
});
