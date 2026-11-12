# Group progress

How a shared collection shows where every member is on every verse. Groups, sync and the
server functions are in [shared-collections.md](shared-collections.md).

## Collection screen

`app/(tabs)/(library)/[id].tsx`, only when `Collection.sharedId` is set; a personal collection
looks as it always did.

- **What syncs when**: each visit runs `openSharedCollection` once (sync, then the grid), and pull
  to refresh runs it again. An add or remove by you, and the owner's role or member changes,
  refetch the grid if it's loaded. Nothing beyond `get_shared_status` is read on the Library list.
- **The grid** (`sharedProgress[group]`): `get_shared_members`, `get_shared_progress` and the
  group's `shared_collection_verses`. `lib/shared/progress.ts` (pure, `progress.test.ts`) turns it
  into one state per member per reference: Engraved, else Mastered (`hard.completed`, so Due and
  Locked are Mastered), else Learning (any `bestAccuracy`), else Open; a missing square is Open.
  Your own squares come from your verses in this collection, so they move the moment a session
  saves. A failed read keeps the last grid and shows Retry on the strip.
- **Group progress** = mastered squares (engraved included) over members × references. This is
  the one definition; `mastered_squares` in `get_shared_status` counts the same squares.
- **Strip** (`SharedStrip`, under the header): member initials, "N members · V verses", the group
  percentage with its bar, and "K of V verses mastered by everyone". Tapping opens the members
  sheet.
- **Cards**: a You dot on the left (`MemberStateDot`: open ring, amber learning ring, green
  mastered, gold engraved) and a Group column on the right (`GroupCount`: "mastered/members" over
  a bar of every member's state, or "✓ All" when everyone has mastered it). The review badge stays.
- **Open verses**: the ones you haven't mastered. "Open · N" filters the list to them, and
  "Practice your N open verses" opens setup on the first of them in the list's order, the same
  screen a tap opens. Both hide at zero.

## Browser checks

After `npm run db:reset`: `npm run sim -- flow shared-progress` (the seeded Romans 8 as Cara and
Dana: strip, You and Group values, open filter, Practice, Cara makes Dana an editor, Dana adds
Romans 8:31, Cara sees it). Shots: `npm run sim -- shot "/(tabs)/(library)/seed-romans-8" --as
reader-c` and `"/(tabs)/(library)/shared-cccccccc-0000-4000-8000-000000000031" --as reader-d`.

## Decisions

- 2026-11-11 · Your own squares on the collection screen come from your local verses, the rest from the grid · Your You dot, review badge and open count then agree, and a session's result shows without a refetch.
