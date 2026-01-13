# Components Layer

## Purpose

Reusable UI components that build up screens. These are atomic and molecular components that encapsulate UI logic and styling.

## Responsibilities

- Consistent UI building blocks
- Component-level styling and theming
- Component-level state management
- Accessibility features
- Animation and interaction logic
- Props-based customization

## Source Files to Review

### UI Components
- `components/ui/collapsible.tsx`
- `components/ui/EngravedIcon.tsx`
- `components/ui/icon-symbol.tsx`
- `components/ui/icon-symbol.ios.tsx`
- `components/ui/NoInternetOverlay.tsx`
- `components/ui/PopoverMenu.tsx`
- `components/ui/Skeleton.tsx`

### Generic Components
- `components/app-header.tsx`
- `components/external-link.tsx`
- `components/haptic-tab.tsx`
- `components/hello-wave.tsx`
- `components/parallax-scroll-view.tsx`
- `components/themed-text.tsx`
- `components/themed-view.tsx`

### Study Components
- `components/study/AlignmentHelpModal.tsx`
- `components/study/ProgressCard.tsx`
- `components/study/ProgressInfoModal.tsx`
- `components/study/RecordingBar.tsx`
- `components/study/ResultCard.tsx`
- `components/study/VerseCard.tsx`
- `components/study/Waveform.tsx`

### Library Components
- `components/library/AddCollectionModal.tsx`
- `components/library/CollectionCardSkeleton.tsx`
- `components/library/SwipeableCollectionCard.tsx`
- `components/library/SwipeableVerseCard.tsx`
- `components/library/VerseCardSkeleton.tsx`

### Home Components
- `components/home/InsightsCard.tsx`
- `components/home/VOTMCard.tsx`

## Review Focus

### Scale Issues
- Do components re-render unnecessarily?
- Are components properly memoized (React.memo)?
- Do animations/transitions impact performance?
- Do large lists render all items or use virtualization?

### Code Quality
- Is component responsibility single and focused?
- Are props well-typed (no `any`)?
- Is component state management clear?
- Are props validated?
- Is accessibility built in?
- Is styling approach consistent?

### Future-Proofing
- Can we easily add component variants/states?
- Can we theme components consistently?
- Can we test components in isolation?
- Can we add animations without breaking logic?

### Known Concerns
- Swipeable components complexity (SwipeableCollectionCard, SwipeableVerseCard)
- Modal lifecycle and cleanup
- Skeleton loading state correctness
- Recording bar and waveform complexity

## Related Sections

- `BY_LAYER/Frontend-Screens/` - Components used by screens
- `BY_LAYER/State-Management/` - State accessed by components
- `constants/theme.ts` - Theming constants

## Next Steps

Create a `FINDINGS.md` file in your output directory.
