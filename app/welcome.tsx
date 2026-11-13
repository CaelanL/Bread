import { Sweep } from '@/components/library/CollectionHeader';
import { InitialDot } from '@/components/shared/MemberDots';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ModalCard, modalStyles } from '@/components/ui/ModalCard';
import { Colors, Motion, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUxFlagsStore } from '@/lib/notifications';
import { useAppStore } from '@/lib/store';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInLeft, FadeInRight, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';

const easing = Easing.bezier(...Motion.easing);
const PAGES = 3;

/**
 * "What's new in Bread" for 2.0: three pages for accounts from before it, opened once by the root
 * layout after lib/welcome.ts claims it. A route, not an RN Modal (see ModalCard), and it holds
 * the reminders card while mounted, the way JoinInvite does.
 */
export default function WelcomeScreen() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const reduced = useReducedMotion();
  const [page, setPage] = useState(0);
  const [forward, setForward] = useState(true);
  // Every page takes the tallest one's height, so the card doesn't jump between pages.
  const [pageHeight, setPageHeight] = useState(0);

  useEffect(() => {
    useUxFlagsStore.getState().setInviteOpen(true);
    return () => useUxFlagsStore.getState().setInviteOpen(false);
  }, []);

  const go = (next: number) => {
    setForward(next > page);
    setPage(next);
  };
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };
  // Library shows the Share action on every collection; with none yet, start a new shared one.
  const share = () => {
    const hasCustom = useAppStore.getState().collections.some((c) => !c.isDefault && !c.isVirtual);
    router.dismissTo('/(tabs)/(library)');
    if (!hasCustom) router.push('/share/new');
  };

  const entering = reduced ? FadeIn.duration(Motion.expandMs) : (forward ? FadeInRight : FadeInLeft).duration(Motion.expandMs).easing(easing);
  const last = page === PAGES - 1;

  return (
    <ModalCard onClose={close}>
      <Animated.View
        key={page}
        entering={entering}
        style={{ minHeight: pageHeight }}
        onLayout={(e) => { const { height } = e.nativeEvent.layout; setPageHeight((h) => Math.max(h, height)); }}
        testID={`welcome-page-${page + 1}`}
      >
        {page === 0 && <WhatsNew />}
        {page === 1 && <Together />}
        {page === 2 && <ShareSteps />}
      </Animated.View>

      <View style={styles.dots} accessibilityLabel={`Page ${page + 1} of ${PAGES}`}>
        {Array.from({ length: PAGES }, (_, i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i === page ? colors.primary : colors.border }]} />
        ))}
      </View>

      <Pressable
        testID={last ? 'welcome-share' : 'welcome-next'}
        accessibilityRole="button"
        onPress={last ? share : () => go(page + 1)}
        style={({ pressed }) => [modalStyles.button, { backgroundColor: colors.primary }, pressed && styles.pressed]}
      >
        <Text style={[modalStyles.buttonText, { color: colors.white }]}>{last ? 'Share a collection' : 'Next'}</Text>
      </Pressable>
      {/* Always there, so the card keeps its height from page to page. */}
      <View style={styles.secondaryRow}>
        {page > 0 && <SecondaryButton testID="welcome-back" label="Back" onPress={() => go(page - 1)} />}
        {last && <SecondaryButton testID="welcome-not-now" label="Not now" onPress={close} />}
      </View>
    </ModalCard>
  );
}

function SecondaryButton({ testID, label, onPress }: { testID: string; label: string; onPress: () => void }) {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
      <Text style={[styles.secondaryText, { color: colors.icon }]}>{label}</Text>
    </Pressable>
  );
}

const NEWS: { icon: ComponentProps<typeof IconSymbol>['name']; title: string; copy: string }[] = [
  { icon: 'person.2.fill', title: 'Shared collections', copy: 'Memorize with friends, side by side.' },
  { icon: 'magnifyingglass', title: 'Quick add', copy: 'Type a reference, add a whole range.' },
  { icon: 'book.fill', title: 'Explore collections', copy: 'Curated sets and a monthly verse.' },
  { icon: 'square.grid.2x2', title: 'Collection icons', copy: 'Give each collection a look of its own.' },
  { icon: 'checkmark', title: 'A new finish', copy: 'Your score counts up as you finish.' },
  { icon: 'eye.slash', title: 'Hide verses', copy: 'Practice from the reference alone.' },
];

function WhatsNew() {
  const colors = Colors[useColorScheme() ?? 'light'];
  return (
    <>
      <Text style={[modalStyles.eyebrow, { color: colors.primary }]}>Version 2.0</Text>
      <Text accessibilityRole="header" style={[modalStyles.title, styles.titleGap, { color: colors.text }]}>What’s new in Bread</Text>
      <View style={styles.list}>
        {NEWS.map((item) => (
          <View key={item.title} style={styles.item}>
            <View style={[styles.icon, { backgroundColor: colors.cardAlt }]}>
              <IconSymbol name={item.icon} size={16} color={colors.primary} />
            </View>
            <View style={styles.itemText}>
              <Text style={[styles.itemTitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[modalStyles.meta, { color: colors.icon }]}>{item.copy}</Text>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

const FRIENDS = ['Anna Lee', 'Ben', 'Cara Diaz'];

function Together() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const reduced = useReducedMotion();
  const you = useAppStore((s) => s.displayName) ?? 'You';
  const members = [...FRIENDS, you];
  const fillDelay = members.length * Motion.staggerMs + Motion.expandMs;
  const [done, setDone] = useState(reduced);
  const fill = useSharedValue(reduced ? 1 : 0.08);
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  useEffect(() => {
    if (reduced) return;
    fill.value = withDelay(fillDelay, withTiming(1, { duration: Motion.scoreMs, easing }, (finished) => {
      if (finished) runOnJS(setDone)(true);
    }));
  }, [reduced, fill, fillDelay]);

  return (
    <>
      <Text accessibilityRole="header" style={[modalStyles.title, { color: colors.text }]}>Memorize together</Text>
      <Text style={[modalStyles.copy, styles.lead, { color: colors.icon }]}>
        Share a collection and everyone learns the same verses, at their own pace.
      </Text>
      <View style={styles.together}>
        <View style={styles.members} accessibilityLabel={`${members.length} members`}>
          {members.map((name, i) => (
            <Animated.View
              key={name + i}
              entering={(reduced ? FadeIn : FadeInRight).delay(Motion.expandMs + i * Motion.staggerMs).duration(Motion.expandMs)}
              style={i > 0 && styles.overlap}
            >
              <InitialDot name={name} you={i === members.length - 1} large ring={colors.card} />
            </Animated.View>
          ))}
        </View>
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          {done ? (
            <Animated.View entering={FadeIn.duration(Motion.expandMs)} style={StyleSheet.absoluteFill}>
              <LinearGradient colors={[colors.masteredBarStart, colors.masteredBarEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
              <Sweep color={colors.white} />
            </Animated.View>
          ) : (
            <Animated.View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: colors.success }, fillStyle]} />
          )}
        </View>
        <Text style={[styles.status, { color: done ? colors.success : colors.icon }]}>
          {done ? 'Mastered by everyone' : 'Learning together'}
        </Text>
      </View>
    </>
  );
}

const STEPS = ['Open a collection', 'Tap Share', 'Send the link'];
const STEP_HEIGHT = 44;

function ShareSteps() {
  const colors = Colors[useColorScheme() ?? 'light'];
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const y = useSharedValue(0);
  const highlight = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  // Steps through 1, 2, 3 and around again, so the order reads at a glance.
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % STEPS.length), Motion.pulseMs);
    return () => clearInterval(timer);
  }, [reduced]);
  useEffect(() => {
    y.value = withTiming(step * STEP_HEIGHT, { duration: Motion.expandMs, easing });
  }, [step, y]);

  return (
    <>
      <Text accessibilityRole="header" style={[modalStyles.title, { color: colors.text }]}>Share in three taps</Text>
      <View style={styles.center}>
      <View style={styles.steps}>
        {!reduced && <Animated.View style={[styles.highlight, { backgroundColor: colors.cardAlt }, highlight]} />}
        {STEPS.map((label, i) => {
          const active = reduced || i === step;
          return (
            <View key={label} style={styles.step}>
              <View style={[styles.badge, { backgroundColor: active ? colors.primary : colors.cardAlt }]}>
                <Text style={[styles.badgeText, { color: active ? colors.white : colors.icon }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.itemTitle, { color: colors.text }]}>{label}</Text>
            </View>
          );
        })}
      </View>
      <Text style={[modalStyles.copy, { color: colors.icon }]}>Friends tap the link to join.</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 16 },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  secondaryRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, minHeight: 44, marginTop: 4 },
  secondary: { height: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  lead: { marginTop: 8 },
  titleGap: { marginTop: 4 },
  list: { marginTop: 20, gap: 14 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 36, height: 36, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1 },
  itemTitle: { fontSize: 16, lineHeight: 21, fontWeight: '600' },
  together: { flex: 1, justifyContent: 'center', paddingVertical: 20, gap: 14, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center' },
  members: { flexDirection: 'row', paddingLeft: 8 },
  overlap: { marginLeft: -8 },
  track: { alignSelf: 'stretch', height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { borderRadius: Radius.full, transformOrigin: 'left' },
  status: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  steps: { marginTop: 20, marginBottom: 16 },
  highlight: { position: 'absolute', left: 0, right: 0, height: STEP_HEIGHT, borderRadius: Radius.lg },
  step: { height: STEP_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8 },
  badge: { width: 26, height: 26, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 13, fontWeight: '600' },
});
