# Group progress

How a shared collection shows where every member is on every verse. Groups, sync and the
server functions are in [shared-collections.md](shared-collections.md).

## Squares

A square is one member on one reference. `private.member_squares` (behind `get_shared_progress`
and `get_shared_status`) folds every row the member holds for the exact reference, in any
translation and soft-deleted ones included, with `bool_or`: `practiced` = any difficulty has a
`bestAccuracy` (`hasPracticed` in `lib/store/review.ts`, the In Progress rule), `mastered` =
`hard.completed`, `engraved` = `engraved.completed`. A reference with no row is missing from
`get_shared_progress` and reads as Open.

State per square (`cellState` in `lib/shared/progress.ts`): Engraved, else Mastered (so Due and
Locked are Mastered), else Learning, else Open.

**Group progress** = mastered squares (engraved included) over members × references.
`mastered_squares` in `get_shared_status` counts the same squares; everyone mastered or engraved
means every square is.

## Collection screen

`app/(tabs)/(library)/[id].tsx`, only when `Collection.sharedId` is set; a personal collection
looks as it always did.

- **What syncs when**: each visit runs `openSharedCollection` once (sync, then the grid), and pull
  to refresh runs it again. An add or remove by you, and the owner's role or member changes,
  refetch the grid if it's loaded. Nothing beyond `get_shared_status` is read on the Library list.
- **The grid** (`sharedProgress[group]`): `get_shared_members`, `get_shared_progress` and the
  group's `shared_collection_verses`, turned into squares by `lib/shared/progress.ts` (pure,
  `progress.test.ts`). Your own squares come from your verses in this collection, so they move the
  moment a session saves. A failed read keeps the last grid and shows Retry on the strip; until a
  grid arrives the Group column reads "–" (loading, or unavailable after a failure).
- **Strip** (`SharedStrip`, under the header): member initials (yours first and solid),
  "Shared · N members · V verses", the group percentage with its bar, and "K of V verses mastered
  by everyone". The members line opens the
  members sheet (invite, Leave); the progress opens [Who's where](#whos-where).
- **Cards**: a You dot on the left (`MemberStateDot`, the tile fills below as a dot) and a Group
  column on the right (`GroupCount`: "mastered/members" over a bar of every member's state, or a
  checkmark and "All" when everyone has mastered it). The bar shows up to 8
  members (`MAX_BAR_MEMBERS`); above that only the count. The review badge stays.
- **Open verses**: the ones you haven't mastered. "Open · N" filters the list to them, and
  "Practice your N open verses" opens setup on the first of them in the list's order, the same
  screen a tap opens. Both hide at zero.

## Who's where

`app/(tabs)/(library)/shared/[id].tsx`, pushed from the strip's progress; `id` is the local
collection, as on the collection screen. It reads the same grid (`useSharedGrid`, your squares from
your verses), nothing new.

- **Grid**: one card, the group progress line on top, then members across and references down.
  Your column comes first, marked by the only solid initial circle, then the owner and the rest by
  join (`whoIsWhere` in `lib/shared/progress.ts`). References are in Bible order, as text only, one
  line in a 124 pt column. Each square is a 20 pt tile (`MemberStateSquare`, fills from
  `memberStateFill`): Open `cardAlt` with a hairline, Learning `warning`, Mastered `success`,
  Engraved `tint`. Tiles are labelled for VoiceOver "Dana, Romans 8:28, Mastered" and don't press.
  A "Mastered" row under the tiles counts each member's mastered squares, and a legend of the
  four states closes the card.
- **Wide groups**: columns sit at a fixed 26 pt pitch (`GRID_PITCH`) and never stretch. When they
  are wider than the space measured beside the references (`gridScrolls`), they scroll sideways
  and the reference column stays put; 7 fit on a 393 pt phone.
- **Members**: `MemberRow`, the same rows as the members sheet: name ("You" after yours) and
  role. The owner taps another member for Make editor / Make member and Remove (`manageMember`
  in `components/shared/member-actions.ts`, the store's `setSharedMemberRole` and
  `removeSharedMember`), here and on the sheet. Invite and Leave stay on the sheet.
- **Reads**: each visit reads the grid once (`fetchSharedProgress`); pull to refresh runs the
  collection screen's refresh, sync and grid read. A failed read keeps the last grid with
  "Couldn't refresh. Retry"; with none yet it shows "Couldn't load Who's where." and Retry.

## Browser checks

After `npm run db:reset`: `npm run sim -- flow shared-progress` (the seeded Romans 8 as Cara and
Dana: strip, You and Group values, open filter, Practice, Cara makes Dana an editor, Dana adds
Romans 8:31, Cara sees it); `npm run sim -- flow shared-grid` (Dana opens Who's where from the
strip: four states, your column first, member list; Cara opens it by link and makes Dana an editor
there). Shots: `npm run sim -- shot "/(tabs)/(library)/seed-romans-8" --as
reader-c` and `"/(tabs)/(library)/shared-cccccccc-0000-4000-8000-000000000031" --as reader-d`;
Who's where at `"/(tabs)/(library)/shared/seed-romans-8" --as reader-c` and
`"/(tabs)/(library)/shared/shared-cccccccc-0000-4000-8000-000000000031" --as reader-d`, light and dark.

## Decisions

- 2026-11-11 · Your own squares on the collection screen come from your local verses, the rest from the grid · Your You dot, review badge and open count then agree, and a session's result shows without a refetch.
- 2026-11-11 · Who's where puts your column first and lists references in Bible order · You look for yourself first; the collection screen keeps your own sort, the grid is a fixed table.
- 2026-11-11 · Who's where reads the collection screen's grid and opens from the strip's progress; the members line still opens the sheet · One read path, and invite and Leave stay where slice 2 put them.
- 2026-11-11 · Column headers carry only the initial, mastered counts sit in a row under the tiles, and roles show in the member list · A role badge and a count don't fit a 26 pt column.
- 2026-11-11 · Learning is solid `warning`, not 30% alpha · The alpha tint turned brown on dark and read as a darker Engraved.
- 2026-11-11 · Your column is marked by a solid `primary` circle, not a caption · One marker, no extra row, the same mark on the strip and the member rows.
- 2026-11-11 · Columns keep a fixed 26 pt pitch and scroll from the measured width · Stretched columns spread a two-member grid across the card, and a member-count cutoff overlapped columns beside long references.
