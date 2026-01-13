# Data-Mutations Domain

## Purpose

Handles operations that modify data in the system: reordering verses, renaming collections, reorganizing libraries, bulk operations, and other data transformation operations that need to maintain consistency.

## Key Responsibilities

- Reorder verses within collections
- Rename collections and update metadata
- Move verses between collections
- Bulk operations (bulk move, bulk delete)
- Maintain referential integrity during mutations
- Sync mutations to server
- Handle undo/redo or confirmation flows

## Source Files to Review

### Frontend
- `app/(tabs)/(library)/[id].tsx` - Collection view (may include reorder UI)
- `components/library/SwipeableVerseCard.tsx` - Verse card (delete, move interactions)
- `components/library/AddCollectionModal.tsx` - Collection creation/renaming

### State Management
- `lib/store/index.ts` - Check mutation actions (updateProgress, updateVerse, etc.)

### Data Sync
- `lib/sync/verses.ts` - Verse mutations sync
- `lib/sync/collections.ts` - Collection mutations sync

### API
- `lib/api/index.ts` - API exports (check for mutation endpoints)

## Review Focus

### Scale Issues
- How do we handle reordering 1000+ verses efficiently?
- Does reordering trigger unnecessary re-renders?
- Are mutations batched or are we making individual API calls?
- Does concurrent mutations (user reorders while another device deletes) cause conflicts?
- How are mutations queued/throttled?

### Code Quality
- Are mutations atomic (all-or-nothing)?
- Is rollback logic present if mutation fails?
- Are there race conditions during mutations?
- Is error recovery clear (user is informed if mutation fails)?
- Are mutations idempotent (safe to retry)?
- Is the code that executes mutations clearly separated from display logic?

### Future-Proofing
- Can we easily add undo/redo?
- Can we add audit logging for mutations?
- Can we add mutation history/changelog?
- Can we handle mutations while offline and sync later?
- Can we add collaborative mutations (multiple users editing)?

### Known Concerns
- Reordering logic complexity
- Concurrent mutation handling
- Sync conflicts between local and server
- Error recovery and user feedback
- Performance of bulk operations

## Related Sections

- `BY_DOMAIN/Library-Management/` - Collections context
- `BY_LAYER/State-Management/` - Mutation state updates
- `BY_LAYER/Data-Sync/` - Sync strategy for mutations
- `BY_ARCHITECTURE/Data-Flow/` - How mutations flow through app
- `BY_ARCHITECTURE/Error-Handling/` - Mutation error handling

## Next Steps

Create a `FINDINGS.md` file in your output directory at `code-review-output-[your-name]/BY_DOMAIN/Data-Mutations/FINDINGS.md` and document your review.
