# Library-Management Domain

## Purpose

Manages user's verse collections, organization, adding/removing verses, and collection metadata. This is where users organize their scripture study material.

## Key Responsibilities

- Create and delete collections
- Add verses to collections
- Remove verses from collections
- Rename collections and update metadata
- Display user's library
- Search and filter verses in collections
- Sync collections between local storage and server

## Source Files to Review

### Frontend
- `app/(tabs)/(library)/index.tsx` - Library list screen
- `app/(tabs)/(library)/[id].tsx` - Individual collection view
- `app/(tabs)/(library)/add.tsx` - Add verses interface
- `app/(tabs)/(library)/add/[book]/[chapter].tsx` - Book/chapter selection
- `app/(tabs)/(library)/setup/[id].tsx` - Collection setup/editing
- `components/library/AddCollectionModal.tsx` - Modal for creating collections
- `components/library/SwipeableCollectionCard.tsx` - Collection card UI
- `components/library/SwipeableVerseCard.tsx` - Verse card in collection

### State Management
- `lib/store/index.ts` - Collection state in Zustand store (check collection operations)

### Data Sync
- `lib/sync/collections.ts` - Local ↔ Server sync for collections
- `lib/sync/migration.ts` - Data migration on app launch

## Review Focus

### Scale Issues
- How does performance scale with 1000+ collections?
- How does list rendering perform with 10k+ verses?
- Are we using virtualization for large lists?
- Is filtering/searching efficient?
- Does the sync strategy handle large collection changes?

### Code Quality
- Are collection IDs properly typed?
- Error handling when collection operations fail?
- Are there race conditions when adding/removing verses simultaneously?
- Is the UI properly showing loading states during sync?
- Are modal states managed correctly?

### Future-Proofing
- Can we easily add collection types (playlists, groups)?
- Can we reorder verses without data migration?
- Can we add metadata fields (tags, notes) without refactoring?
- Can we add bulk operations (bulk move, bulk delete)?
- Can we share collections with other users later?

### Known Concerns
- SwipeableCollectionCard and SwipeableVerseCard complexity
- Sync conflict resolution for collections
- Performance with large collections
- Modal state management (AddCollectionModal)

## Related Sections

- `BY_LAYER/Frontend-Screens/` - Library screens
- `BY_LAYER/State-Management/` - Collection state in store
- `BY_LAYER/Data-Sync/` - Collection sync logic
- `BY_DOMAIN/Data-Mutations/` - Reordering, renaming operations
- `BY_ARCHITECTURE/Data-Flow/` - How collections flow through app

## Next Steps

Create a `FINDINGS.md` file in your output directory at `code-review-output-[your-name]/BY_DOMAIN/Library-Management/FINDINGS.md` and document your review.
