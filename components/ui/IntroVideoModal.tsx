import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Fonts, Motion, Radius } from '@/constants/theme';
import { introCaption, type IntroMedia } from '@/lib/intro/media';

export function IntroVideoModal({ media, visible, onClose }: {
  media: IntroMedia;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = Colors.dark;
  const insets = useSafeAreaInsets();
  const player = useRef<Video>(null);
  const active = useRef(visible);
  active.current = visible;
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (visible) {
      setPosition(0); setPlaying(false); setLoaded(false); setFinished(false); setError(false);
    } else {
      void player.current?.unloadAsync().catch(() => {});
    }
    return () => { void player.current?.unloadAsync().catch(() => {}); };
  }, [visible]);

  const onStatus = (status: AVPlaybackStatus) => {
    if (!active.current) return;
    if (status.isLoaded) {
      setLoaded(true); setPosition(status.positionMillis); setPlaying(status.isPlaying);
      if (status.didJustFinish) setFinished(true);
    } else if (status.error) setError(true);
  };
  const close = () => {
    active.current = false;
    void player.current?.unloadAsync().catch(() => {});
    onClose();
  };
  const toggle = async () => {
    try {
      if (error) {
        setError(false); setLoaded(false);
        await player.current?.unloadAsync();
        await player.current?.loadAsync(source, { shouldPlay: true });
      } else if (finished) { setFinished(false); await player.current?.replayAsync(); }
      else if (playing) await player.current?.pauseAsync();
      else await player.current?.playAsync();
    } catch { setError(true); }
  };

  if (!visible || !media.playback) return null;
  const source = typeof media.playback === 'number' ? media.playback : { uri: media.playback };
  const seconds = Math.floor(position / 1000);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

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
          {media.fixture && <Text style={[styles.fixture, { color: colors.icon }]}>Development fixture · sound follows silent mode</Text>}
          <View style={[styles.frame, { backgroundColor: colors.card }]}>
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
          </View>
          <Text testID="intro-caption" style={[styles.caption, { color: colors.text }]} accessibilityLiveRegion="polite">
            {error ? 'This video could not load. You can close it or try replaying.' : introCaption(media, position)}
          </Text>
          <View style={styles.controls}>
            <Pressable
              testID="intro-play-pause"
              accessibilityRole="button"
              accessibilityLabel={finished || error ? 'Replay video' : playing ? 'Pause video' : 'Play video'}
              disabled={!loaded && !error}
              onPress={() => void toggle()}
              style={({ pressed }) => [styles.control, { backgroundColor: colors.cardAlt, opacity: !loaded && !error ? 0.5 : 1, transform: [{ scale: pressed && loaded ? Motion.pressScale : 1 }] }]}
            >
              <IconSymbol name={finished || error ? 'arrow.counterclockwise' : playing ? 'pause.fill' : 'play.fill'} size={18} color={colors.text} />
              <Text style={[styles.controlText, { color: colors.text }]}>{finished || error ? 'Replay' : playing ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <Text testID="intro-progress" style={[styles.progress, { color: colors.icon }]}>{time}</Text>
          </View>
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
  caption: { fontSize: 18, lineHeight: 27, textAlign: 'center', minHeight: 54 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  control: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: Radius.full },
  controlText: { fontSize: 14, fontWeight: '600' },
  progress: { fontSize: 13, fontVariant: ['tabular-nums'] },
  footnote: { textAlign: 'center', fontSize: 13, marginTop: 20 },
});
