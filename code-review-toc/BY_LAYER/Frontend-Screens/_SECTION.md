# Frontend-Screens Layer

## Purpose

Route-level screens and page components that users interact with. These are the top-level UI containers for each major app section.

## Responsibilities

- Route/screen UI layout and structure
- Screen-specific business logic
- Navigation between screens
- Loading and error states at screen level
- Screen-level data fetching and preparation
- Modal and full-screen presentation

## Source Files to Review

### Auth Screens
- `app/(auth)/sign-in.tsx`
- `app/(auth)/sign-up.tsx`
- `app/(auth)/forgot-password.tsx`
- `app/(auth)/_layout.tsx`

### Tab Screens
- `app/(tabs)/home.tsx`
- `app/(tabs)/explore.tsx`
- `app/(tabs)/insights.tsx`
- `app/(tabs)/settings.tsx`
- `app/(tabs)/_layout.tsx`

### Library Screens
- `app/(tabs)/(library)/index.tsx`
- `app/(tabs)/(library)/[id].tsx` - Collection detail view
- `app/(tabs)/(library)/add.tsx`
- `app/(tabs)/(library)/add/[book]/[chapter].tsx`
- `app/(tabs)/(library)/setup/[id].tsx`
- `app/(tabs)/(library)/_layout.tsx`

### Modal Screens
- `app/session.tsx` - Study session (full-screen modal)
- `app/modal.tsx` - Generic modal
- `app/_layout.tsx` - Root layout

## Review Focus

### Scale Issues
- Do screens re-render unnecessarily?
- Are screens properly memoized?
- Does navigation performance degrade with many screens?
- Are heavy computations happening in render?

### Code Quality
- Is screen logic focused (does one thing)?
- Is state management clear (local vs global)?
- Are loading states properly handled?
- Are error states clearly communicated?
- Is accessibility considered (screen readers, keyboard nav)?
- Are prop drilling issues present?

### Future-Proofing
- Can we easily add new screens?
- Can we add screen transitions/animations?
- Can we add deep linking to specific screens?
- Can we add screen-specific analytics/tracking?

### Known Concerns
- Navigation state management
- Modal lifecycle and cleanup
- Loading state clarity
- Error recovery from failed data fetches

## Related Sections

- `BY_LAYER/Components/` - Components used by screens
- `BY_LAYER/State-Management/` - Global state accessed
- `BY_ARCHITECTURE/Data-Flow/` - Data flows into screens

## Next Steps

Create a `FINDINGS.md` file in your output directory.
