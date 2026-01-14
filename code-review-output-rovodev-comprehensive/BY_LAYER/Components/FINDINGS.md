[STATUS: review_done_needs_followup]

# Components Layer Review

## Summary
The Components layer demonstrates solid craftsmanship with well-designed UI components like AppHeader, Collapsible, and RecordingBar. Most components are properly typed and focused on single responsibilities. However, there are concerns around component memoization, animation performance, and complex interactive components like SwipeableVerseCard that need optimization.

---

## Critical Issues

### 1. SwipeableVerseCard Has Text Loading Race Condition
**File:** `components/library/SwipeableVerseCard.tsx` (lines ~49-57)
**Severity:** HIGH
**Issue:**
```typescript
useEffect(() => {
  if (!verse.text) {
    setLoading(true);
    getVerseText(verse)
      .then(setText)
      .catch(() => setText('Failed to load verse text'))
      .finally(() => setLoading(false));
  }
}, [verse]);
```
- If verse prop changes while loading, previous fetch continues
- New fetch starts before old one completes
- Both updates compete to set state
- Could show wrong text for wrong verse

**Impact:**
- Wrong verse text displayed
- User confusion
- Incorrect study material

**Suggested Fix:**
```typescript
useEffect(() => {
  let mounted = true;
  let abortController = new AbortController();
  
  if (!verse.text) {
    setLoading(true);
    getVerseText(verse, { signal: abortController.signal })
      .then(text => {
        if (mounted) setText(text);
      })
      .catch(error => {
        if (!abortController.signal.aborted && mounted) {
          setText('Failed to load verse text');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
  }
  
  return () => {
    mounted = false;
    abortController.abort();
  };
}, [verse.id]); // Depend on verse.id, not entire verse object
```

**Ticket:** Create task: "Fix SwipeableVerseCard text loading race condition"

---

### 2. RecordingBar Spinner Animation Runs Continuously
**File:** `components/study/RecordingBar.tsx`
**Severity:** MEDIUM
**Issue:**
- Spinner animation always runs when isProcessing = true
- No way to pause or throttle animation
- Continuously rotates for indefinite time
- Battery drain on mobile

**Impact:**
- Battery drain
- CPU usage while processing
- Unnecessary redraw cycles

**Suggested Fix:**
```typescript
// Add timeout for spinner
const [elapsed, setElapsed] = useState(0);
const MAX_SPINNER_TIME = 300000; // 5 minutes max

useEffect(() => {
  if (!isProcessing) return;
  
  const interval = setInterval(() => {
    setElapsed(prev => {
      if (prev >= MAX_SPINNER_TIME) {
        // Timeout spinner if processing takes too long
        console.warn('Processing timeout');
        return prev;
      }
      return prev + 1000;
    });
  }, 1000);
  
  return () => clearInterval(interval);
}, [isProcessing]);

// Warn user if processing takes too long
if (elapsed > 30000 && isProcessing) {
  // Show warning that it's taking longer than expected
}
```

**Ticket:** Create task: "Add timeout and throttling to RecordingBar spinner"

---

## Code Quality Issues

### 1. Components Missing React.memo
**File:** All component files
**Severity:** MEDIUM
**Issue:**
- Components not wrapped in React.memo
- Re-render even when props unchanged
- Lists of components (SwipeableVerseCard) re-render unnecessarily

**Impact:**
- Sluggish UI
- Jank when scrolling lists
- Battery drain

**Suggested Fix:**
```typescript
export const SwipeableVerseCard = React.memo(function SwipeableVerseCard({
  verse,
  index,
  onPress,
  onDelete,
  disableSwipe = false,
}: SwipeableVerseCardProps) {
  // ... component code
}, (prevProps, nextProps) => {
  // Custom comparison for complex objects
  return (
    prevProps.verse.id === nextProps.verse.id &&
    prevProps.index === nextProps.index &&
    prevProps.disableSwipe === nextProps.disableSwipe &&
    JSON.stringify(prevProps.verse.progress) === JSON.stringify(nextProps.verse.progress)
  );
});
```

**Ticket:** Create task: "Add React.memo to all components"

---

### 2. AppHeader Has Hardcoded Padding Values
**File:** `components/app-header.tsx` (line 122)
**Severity:** LOW
**Issue:**
```typescript
paddingTop: 60,  // Hardcoded safe area padding
```
- Assumes safe area is always 60px
- Won't work correctly on devices with different notches
- Not using SafeAreaView or constants

**Impact:**
- Header misaligned on some devices
- Notch issues on Android

**Suggested Fix:**
```typescript
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function AppHeader(props: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      {/* ... */}
    </View>
  );
}
```

**Ticket:** Create task: "Use SafeAreaInsets in AppHeader instead of hardcoded padding"

---

### 3. RecordingBar Has Magic Numbers
**File:** `components/study/RecordingBar.tsx`
**Severity:** LOW
**Issue:**
```typescript
const RECORDING_BAR_HEIGHT = 56;
// But then hardcoded colors and sizes throughout
borderWidth: 2.5,  // Magic number
```
- Colors hardcoded (#ef4444, #9ca3af)
- Sizes hardcoded (20, 40, 44, etc.)
- No design system integration

**Impact:**
- Hard to maintain consistent design
- Theme changes require code edits
- No single source of truth for design tokens

**Suggested Fix:**
```typescript
// In constants/theme.ts
export const RECORDING_BAR = {
  HEIGHT: 56,
  ACTIVE_BG: '#ef4444',
  PROCESSING_BG: '#374151',
  BUTTON_SIZE: 44,
  CANCEL_BUTTON_SIZE: 40,
  BORDER_WIDTH: 2.5,
  BORDER_COLOR: '#9ca3af',
};

// Then use in component
backgroundColor: RECORDING_BAR.ACTIVE_BG,
```

**Ticket:** Create task: "Extract RecordingBar design tokens to constants"

---

### 4. Collapsible Component Chevron Animation Not Smooth
**File:** `components/ui/collapsible.tsx` (line 24)
**Severity:** LOW
**Issue:**
```typescript
style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}
```
- Direct rotation without animation
- Toggles instantly, not smooth
- No transition timing

**Impact:**
- Jarring UX
- Looks unpolished

**Suggested Fix:**
```typescript
import Animated, { useAnimatedStyle, interpolate, Extrapolate, withTiming } from 'react-native-reanimated';

export function Collapsible({ children, title }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const rotation = useSharedValue(0);
  
  useEffect(() => {
    rotation.value = withTiming(isOpen ? 90 : 0, { duration: 300 });
  }, [isOpen]);
  
  const chevronAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  
  return (
    <Animated.View style={chevronAnimatedStyle}>
      {/* ... */}
    </Animated.View>
  );
}
```

**Ticket:** Create task: "Add smooth animation to Collapsible chevron"

---

## Performance Issues

### 1. SwipeableVerseCard Complex Gesture Handling
**File:** `components/library/SwipeableVerseCard.tsx` (lines ~72-88)
**Severity:** MEDIUM
**Issue:**
- Complex pan gesture with spring animations
- Used in long lists without virtualization
- Each card has full gesture handler
- Expensive animations on scroll

**Impact:**
- Jank when scrolling lists
- Frame drops
- Battery drain

**Suggested Fix:**
```typescript
// Wrap in memo with gesture optimization
export const SwipeableVerseCard = React.memo(function(...) {
  // Only enable gesture when not swiped
  const panGesture = Gesture.Pan()
    .enabled(!disableSwipe && !isAnimating)
    .simultaneousWithExternalGesture(scrollGesture)
    // ... rest
});

// Or use a simpler delete button without swipe gesture
// for lists where swipe is less critical
```

**Ticket:** Create task: "Optimize SwipeableVerseCard gesture performance"

---

### 2. No Skeleton Component Loading States
**File:** `components/library/VerseCardSkeleton.tsx`
**Severity:** MEDIUM
**Issue:**
- Skeleton components exist but may not be properly optimized
- Animations run for all skeletons in list
- No lazy loading or virtualization

**Impact:**
- Long skeleton lists are slow
- Unnecessary animations

**Suggested Fix:**
```typescript
// Only animate visible skeletons
export const SkeletonCard = React.memo(function SkeletonCard({ isVisible }) {
  const opacity = useSharedValue(isVisible ? 0.6 : 0);
  
  useEffect(() => {
    if (isVisible) {
      opacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 600 }),
          withTiming(0.6, { duration: 600 })
        ),
        -1
      );
    }
  }, [isVisible]);
  
  return <Animated.View style={{ opacity }} />;
});
```

**Ticket:** Create task: "Optimize skeleton animations to only run for visible items"

---

## Future-Proofing Issues

### 1. No Component Variant System
**File:** All components
**Severity:** MEDIUM
**Issue:**
- Components hardcoded for single use case
- Hard to create variations (small/large, primary/secondary)
- Design system evolution difficult

**Impact:**
- Can't easily create component variations
- Duplication when similar components needed
- Hard to maintain consistent design

**Suggested Fix:**
```typescript
// Design system approach
interface ButtonVariant {
  size: 'small' | 'medium' | 'large';
  variant: 'primary' | 'secondary' | 'destructive';
  state: 'default' | 'active' | 'disabled';
}

interface AppHeaderProps {
  title?: string;
  rightButton?: RightButtonProps & ButtonVariant;
  // ...
}

// Component responds to variants
const getButtonStyles = (variant: ButtonVariant) => {
  const sizeMap = {
    small: { paddingHorizontal: 8, height: 32 },
    medium: { paddingHorizontal: 14, height: 40 },
    large: { paddingHorizontal: 20, height: 48 },
  };
  // ...
};
```

**Ticket:** Create task: "Design component variant system"

---

### 2. No Accessibility Features
**File:** All components
**Severity:** HIGH
**Issue:**
- No accessible labels (accessibilityLabel)
- No role definitions (accessibilityRole)
- No accessible descriptions
- Gesture components not keyboard accessible
- Screen readers can't navigate

**Impact:**
- App unusable for visually impaired users
- Legal compliance issues (ADA, WCAG)
- Feature parity issues

**Suggested Fix:**
```typescript
<Pressable
  accessible
  accessibilityLabel="Delete verse"
  accessibilityHint="Double tap to delete this verse from your collection"
  accessibilityRole="button"
  onPress={handleDelete}
>
  {/* ... */}
</Pressable>

// For complex gestures, add keyboard alternatives
<KeyboardSwipeGesture
  onSwipeLeft={handleDelete}
  onKeyDown={(key) => {
    if (key === 'Delete' || key === 'Backspace') {
      handleDelete();
    }
  }}
>
  {/* ... */}
</KeyboardSwipeGesture>
```

**Ticket:** Create task: "Add comprehensive accessibility labels and roles to components"

---

### 3. No Component Composition Examples
**File:** All components
**Severity:** LOW
**Issue:**
- No documentation on how to use components together
- No Storybook or component catalog
- Hard for new developers to discover components

**Impact:**
- Onboarding slower
- Duplication of similar components
- Inconsistent usage

**Suggested Fix:**
```typescript
// Create storybook or component showcase
// app/storybook.tsx or similar
export const ComponentShowcase = () => {
  const [component, setComponent] = useState('button');
  
  return (
    <ScrollView>
      <AppHeader title="Component Showcase" />
      
      <Section title="Buttons">
        <AppHeader
          rightButton={{
            label: 'Primary',
            variant: 'filled',
            onPress: () => {},
          }}
        />
        <AppHeader
          rightButton={{
            label: 'Secondary',
            variant: 'text',
            onPress: () => {},
          }}
        />
      </Section>
      
      {/* ... more components */}
    </ScrollView>
  );
};
```

**Ticket:** Create task: "Create component showcase/storybook"

---

## Scale Issues

### 1. No Virtualization for Long Lists of Components
**File:** Components used in lists
**Severity:** MEDIUM
**Issue:**
- SwipeableVerseCard used in FlatList but not optimized
- Each card has full animation and gesture capabilities
- No lazy rendering of off-screen cards

**Impact:**
- Lists with 100+ items are slow
- Memory usage high
- Jank when scrolling

**Suggested Fix:**
```typescript
// In parent screen
<FlatList
  data={verses}
  renderItem={({ item, index }) => (
    <SwipeableVerseCard
      verse={item}
      index={index}
      onPress={handlePress}
      onDelete={handleDelete}
    />
  )}
  keyExtractor={(item) => item.id}
  initialNumToRender={10}
  maxToRenderPerBatch={20}
  windowSize={10}
  removeClippedSubviews
/>
```

**Ticket:** Create task: "Add FlatList optimization props to component lists"

---

## Summary of Tickets to Create

| Ticket | Severity | Category |
|--------|----------|----------|
| Fix SwipeableVerseCard text loading race condition | HIGH | Quality |
| Add timeout and throttling to RecordingBar spinner | MEDIUM | Performance |
| Add React.memo to all components | MEDIUM | Performance |
| Use SafeAreaInsets in AppHeader instead of hardcoded padding | LOW | Quality |
| Extract RecordingBar design tokens to constants | LOW | Code Quality |
| Add smooth animation to Collapsible chevron | LOW | UX |
| Optimize SwipeableVerseCard gesture performance | MEDIUM | Performance |
| Optimize skeleton animations to only run for visible items | MEDIUM | Performance |
| Design component variant system | MEDIUM | Future-Proofing |
| Add comprehensive accessibility labels and roles to components | HIGH | Accessibility |
| Create component showcase/storybook | LOW | Future-Proofing |
| Add FlatList optimization props to component lists | MEDIUM | Scale |

---

## Next Review Section
→ Continue with: `BY_LAYER/State-Management`
