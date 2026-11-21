import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
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
  const colors = Colors.dark;
  const insets = useSafeAreaInsets();
  const player = useRef<Video>(null);
  const interruption = useRef<ReturnType<typeof createIntroInterruption> | null>(null);
  useEffect(() => {
    const current = createIntroInterruption({
      pause: async () => player.current?.pauseAsync(),
      play: async () => player.current?.playAsync(),
    });
    interruption.current = current;
    return () => current.dispose();
  }, []);
  useEffect(() => {
    void interruption.current?.setInactive(inactive).catch(() => {});
  }, [inactive]);
  const active = useRef(visible);
  active.current = visible;
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

  useEffect(() => {
    if (visible) {
      setPosition(0); setPlaying(false); setLoaded(false); setFinished(false); setError(false); setDuration(0); setScrub(null);
    } else {
      void player.current?.unloadAsync().catch(() => {});
    }
    return () => { void player.current?.unloadAsync().catch(() => {}); };
  }, [visible]);

  const onStatus = (status: AVPlaybackStatus) => {
    if (!active.current) return;
    if (status.isLoaded) {
      void interruption.current?.onPlaying(status.isPlaying).catch(() => {});
      setLoaded(true); setPosition(status.positionMillis); setPlaying(status.isPlaying); setDuration(status.durationMillis ?? 0);
      if (status.didJustFinish) setFinished(true);
    } else if (status.error) setError(true);
  };
  const close = () => {
    active.current = false;
    interruption.current?.dispose();
    void player.current?.unloadAsync().catch(() => {});
    onClose();
  };
  const toggle = async () => {
    try {
      if (error) {
        setError(false); setLoaded(false);
        await player.current?.unloadAsync();
        await player.current?.loadAsync(source, { shouldPlay: true });
        return;
      }
      setGlyph(playing && !finished ? 'pause.fill' : 'play.fill');
      glyphOpacity.value = withSequence(
        withTiming(1, { duration: Motion.pressMs }),
        withDelay(Motion.expandMs, withTiming(0, { duration: Motion.expandMs })),
      );
      if (finished) { setFinished(false); await player.current?.replayAsync(); }
      else if (playing) await player.current?.pauseAsync();
      else await player.current?.playAsync();
    } catch { setError(true); }
  };
  const canScrub = loaded && !error && duration > 0;
  const drag = (event: GestureResponderEvent) => {
    track.current.target = seekPosition((event.nativeEvent.pageX - track.current.left) / track.current.width, duration);
    setScrub(track.current.target);
  };
  const seek = async () => {
    const target = track.current.target;
    track.current.target = null;
    if (target === null) return;
    try {
      await player.current?.setPositionAsync(target, { toleranceMillisBefore: 0, toleranceMillisAfter: 0 });
      setPosition(target);
      if (target < duration) setFinished(false);
    } catch { /* The bar returns to the actual position. */ }
    setScrub(null);
  };

  if (!visible || !media.playback) return null;
  const source = typeof media.playback === 'number' ? media.playback : { uri: media.playback };
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
              <Video
                ref={player}
                source={source}
                style={StyleSheet.absoluteFill}
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
                isLooping={false}
                progressUpdateIntervalMillis={250}
                onPlaybackStatusUpdate={onStatus}
                onError={() => { if (active.current) setError(true); }}
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
                onResponderRelease={() => void seek()}
                onResponderTerminate={() => void seek()}
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
