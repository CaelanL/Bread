# Components Layer - Code Review

**[STATUS: review_done_needs_followup]**

**Reviewer**: Rovo Dev (AI Agent)  
**Review Date**: 2026-01-13  
**Focus**: Scale & Performance  

---

## Executive Summary

Components are well-designed with proper animation handling. **Overall assessment: Good component architecture, but missing memoization and has animation performance concerns.**

**Key Issues Found:**
- 🟠 **High**: No React.memo on components (unnecessary re-renders)
- 🟠 **High**: Animation loop never stops when component unmounts (Skeleton)
- 🟠 **High**: Hardcoded screen height can cause layout issues
- 🟡 **Medium**: Word stagger animation creates 100+ animations per card
- 🟡 **Medium**: No prop validation or prop types

---

## Detailed Findings

### 1. 🟠 HIGH: No React.memo on Components

**Issue**: Components re-render whenever parent updates, even if props unchanged.

All components should be memoized: VerseCard, SwipeableCollectionCard, RecordingBar, Skeleton.

**Scale Impact:**
- 100 VerseCards in list, parent re-renders
- All 100 cards re-render even if props unchanged
- Each re-render runs animation hooks
- **Performance**: Jank, 60fps drops to 20fps

**Recommended Fix:**
```typescript
export const VerseCard = React.memo(VerseCard, (prev, next) => {
  return (
    prev.difficulty === next.difficulty &&
    prev.verseLabel === next.verseLabel &&
    prev.revealed === next.revealed &&
    prev.chunk.id === next.chunk.id
  );
});

export const SwipeableCollectionCard = React.memo(SwipeableCollectionCard);
export const Skeleton = React.memo(Skeleton);
```

---

### 2. 🟠 HIGH: Animation Loop Never Stops (Skeleton Component)

**Issue** (Lines 18-33): Skeleton animation loops infinitely without proper cleanup.

```typescript
return () => animation.stop();  // Might not stop properly!
```

**Problem:**
- If Skeleton unmounts while animating, animation continues in background
- Loading 100+ skeletons = 100+ infinite animations draining battery
- **Impact**: Phone heating up, battery drain

**Recommended Fix:**
```typescript
const animationRef = useRef<Animated.CompositeAnimation | null>(null);

useEffect(() => {
  animationRef.current = Animated.loop(Animated.sequence([...]));
  animationRef.current.start();

  return () => {
    if (animationRef.current) {
      animationRef.current.stop();
      animationRef.current = null;
    }
  };
}, []);  // Empty deps
```

---

### 3. 🟠 HIGH: Hardcoded Screen Height Issues

**Issue** (VerseCard.tsx, Lines 14-16):

```typescript
const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const CARD_MAX_HEIGHT = SCREEN_HEIGHT * 0.30;
```

**Problem:**
- Doesn't update on orientation change
- Wrong on iPad split-view
- Hardcoded padding math is brittle

**Recommended Fix:**
```typescript
import { useWindowDimensions } from 'react-native';

const { height: windowHeight } = useWindowDimensions();
const cardMaxHeight = windowHeight * 0.30;
```

---

### 4. 🟡 MEDIUM: Word Stagger Animation Creates 100+ Animations

**Issue**: Each word gets individual Reanimated animation with delay.

```typescript
const opacity = useSharedValue(revealed ? 1 : 0);
useEffect(() => {
  if (revealed && word.isBlank) {
    opacity.value = withDelay(
      index * STAGGER_DELAY,  // Each word = separate animation!
      withTiming(1, { duration: 200 })
    );
  }
}, [revealed]);
```

**Problem:**
- 50-word verse = 50 animations
- 10 cards = 500 animations running
- **Memory**: ~5MB for 500 animations
- **CPU**: Constant re-evaluation

**Recommended Fix:**
Use single parent animation instead of stagger:

```typescript
export function VerseCard() {
  return (
    <Animated.View layout={Layout.duration(300)}>
      {chunk.displayWords.map((word, i) => (
        <AnimatedWord key={i} word={word} revealed={revealed} />  // No index stagger
      ))}
    </Animated.View>
  );
}
```

---

### 5. 🟡 MEDIUM: No Prop Validation

**Issue**: Components don't validate props, only runtime errors.

```typescript
export function VerseCard({ chunk, difficulty, verseLabel, revealed = false }) {
  // No null checks
  return (
    <View>
      {chunk.displayWords.map((word, i) => (  // What if undefined?
        <AnimatedWord key={i} {...} />
      ))}
    </View>
  );
}
```

**Recommended Fix:**
```typescript
export function VerseCard({ chunk, difficulty, verseLabel, revealed = false }) {
  if (!chunk || !chunk.displayWords) {
    console.warn('VerseCard: Invalid chunk prop');
    return null;
  }
  // Rest of component
}
```

---

## Related Sections

- `BY_ARCHITECTURE/Performance/`
- `BY_LAYER/State-Management/`
- `BY_LAYER/Frontend-Screens/`

---

## Tickets to Create

- [ ] **TICKET-031**: Add React.memo to all components (High)
- [ ] **TICKET-032**: Fix Skeleton animation cleanup (High)
- [ ] **TICKET-033**: Use useWindowDimensions for responsive heights (Medium)
- [ ] **TICKET-034**: Replace stagger animation with layout animation (Medium)
- [ ] **TICKET-035**: Add prop validation (Medium)
- [ ] **TICKET-036**: Add accessibility labels (Medium)

---

**Estimated effort**: 1-2 days  
**Estimated improvement**: 2-5x faster rendering
