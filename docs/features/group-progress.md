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

`app/(tabs)/(library)/[id].tsx`. The group parts below show only once someone besides the owner
is in the group (`hasOtherMembers` in `lib/shared/progress.ts`, `member_count > 1`); before that a
shared collection looks like a personal one, and a personal collection looks as it always did.

- **What syncs when**: each visit runs `openSharedCollection` once (sync, then the grid, the group
  row and your own copies, which a removed reference, a removal or a dissolve changes without
  sync; a copy no longer shared drops its grid), and pull to refresh runs it again. When the reload
  shows you were removed, the sync's error is dropped: the "You were removed" notice is the one
  message, and the screen goes back to the Library (a dissolved copy stays open, now personal). An add or remove by you, and the owner's role or member changes,
  refetch the grid if it's loaded. The Library list reads `get_shared_status`, plus `get_shared_members`
  once per group you joined, for the owner's name (`profiles` is private to each user).
- **The grid** (`sharedProgress[group]`): `get_shared_members`, `get_shared_progress` and the
  group's `shared_collection_verses`, turned into squares by `lib/shared/progress.ts` (pure,
  `progress.test.ts`). Your own squares come from your verses in this collection, so they move the
  moment a session saves. A failed read keeps the last grid and shows Retry on the progress line; until a
  grid arrives the count reads "–" (loading, or unavailable after a failure).
- **Header** (`CollectionHeader`, the same for every collection, [library.md](library.md#collection-screen)):
  once others are in, the people line, member initials (in `get_shared_members` order, yours
  solid) and "Cara and Dana · 3 verses" (`listNames`; "<owner's name> · N members" until the grid
  loads), opens the member list (`app/share/[id]?view=members`); under it a thin progress line,
  "50%" and a chevron (mastered squares over all), which opens [Who's where](#whos-where), or "Couldn't
  load · Retry" after a failed read. At 100% the line fills with a soft gradient (light to deep green when
  everyone mastered every verse, champagne to bronze when everyone engraved them), a single
  highlight crosses it quickly once, then keeps crossing a little slower every 2.3 s like a heartbeat (skipped under Reduce Motion), and "100%" reads
  "Mastered by everyone" or "Engraved by everyone" in green or gold, for VoiceOver too.
- **Invite line** (`InviteLine`): for the owner while no one else is in it, "Invite code", the
  code, copy (`square.on.square`) and share (`square.and.arrow.up`), the share card's actions
  (`components/shared/invite-actions.ts`). It reads `getLiveInvite` on each focus, so a new code
  made on the card shows on return; an expired code offers New code (the card).
- **Bar**: person-plus (the owner, and any collection you could share) opens the share card
  (`app/share/[id].tsx`: invite, members and roles, Stop sharing); the dots open Details, Change
  icon, Rename, Stop sharing and Delete, or Details and Leave for a member.
- **Rows**: the same flat rows as a personal collection (difficulty dot, check or engraved glyph, review badge),
  plus the group's count on the right (`GroupCount`): members who mastered the verse, engraved
  included, over all members, "8/10", the same on every row.

## Who's where

`app/(tabs)/(library)/shared/[id].tsx`, pushed from the progress line or Details; `id` is the local
collection, as on the collection screen. It reads the same grid (`useSharedGrid`, your squares from
your verses), nothing new.

- **Layout**: flat on the page, no cards: `TopBar` (back) over a large "Details" with the
  collection's name under it, then "47%" (28 pt figure, the header's 4 pt line, "N of M
  verses mastered by everyone"), then Verses and Members under small uppercase labels.
- **Grid**: members across and references down.
  Your column comes first, marked by the only solid initial circle, then the owner and the rest by
  join (`whoIsWhere` in `lib/shared/progress.ts`). References are in Bible order, as text only, one
  line in a 124 pt column. Each square is a 20 pt tile (`MemberStateSquare`, fills from
  `memberStateFill`): Open `cardAlt` with a hairline, Learning `warning`, Mastered `success`,
  Engraved `tint`. Tiles are labelled for VoiceOver "Dana, Romans 8:28, Mastered" and don't press.
  A "Mastered" row under the tiles counts each member's mastered squares, and a legend of the
  four states closes the section.
- **Wide groups**: columns sit at a fixed 26 pt pitch (`GRID_PITCH`) and never stretch. When they
  are wider than the space measured beside the references (`gridScrolls`), they scroll sideways
  and the reference column stays put; 7 fit on a 393 pt phone. The scrolling part reaches the
  screen's edge, so a cut column is cut there and reads as more to scroll.
- **Members**: `MemberRow`, the same rows as the share panel: name ("You" after yours) and
  role. The owner taps another member for Make editor / Make member and Remove (`manageMember`
  in `components/shared/member-actions.ts`, the store's `setSharedMemberRole` and
  `removeSharedMember`), here and on the panel. Invite and Leave stay on the panel.
- **Reads**: each visit reads the grid once (`fetchSharedProgress`); pull to refresh runs the
  collection screen's refresh, sync and grid read. A failed read keeps the last grid with
  "Couldn't refresh. Retry"; with none yet it shows "Couldn't load details." and Retry.

## Library cards

A collection whose every square is mastered or engraved says so on its Library card with a badge
on the corner of its icon: a green check for mastered, a gold engraved glyph for engraved. An
engraved one also fills the icon square gold and takes a gold wash that fades across the row. The subtitle stays as it is, and the row
keeps the collection's own icon. The badge reads "Mastered" or "Engraved" to VoiceOver, plus "by everyone" on a shared card. The rules are `soloEmblem` and `sharedEmblem` in
`lib/shared/progress.ts`, on `cellState`, so the mastered and engraved tests are the grid's
(`progress.test.ts`). A shared collection uses the shared rule only once someone else joined;
before that it follows the personal one.

| Card | Rule | Icon square | Glyph on the right |
|---|---|---|---|
| Personal, mastered | A real collection, My Verses included, with at least one verse, every verse Mastered or Engraved | Unchanged | `checkmark` in `success` |
| Personal, engraved | The same, every verse Engraved | `engravedFill` behind the icon in `tint` | `EngravedIcon` in `tint` |
| Shared, mastered by everyone | `get_shared_status`: mastered squares = members × verses, above 0 | Unchanged | `checkmark` |
| Shared, engraved by everyone | Engraved squares = members × verses | As personal engraved | `EngravedIcon` |
| Shared, not yet | Anything else, or no status row yet | Unchanged | None |

The subtitle is "N verses" on a personal card and "<owner's name> · M members" on a shared one
with others in it (`useSharedOwnerName`; the count alone if the name couldn't be read).

Virtual collections never get one. A shared card reads the status from the last hydrate, refresh
or collection visit, and a session that turns one of your squares mastered or engraved refetches it
(`updateVerseProgress`), so finishing the last square shows on the way back; Reset Progress on a
mastered one refetches it too (`resetVerseProgress`). Once the group is gone (Stop sharing, or the
owner deletes it), a member's copy is personal and follows the personal rules.

## Browser checks

The seed (header of `supabase/seed.sql`) gives Cara one collection per emblem ("Psalm 23", "John 15",
"Philippians 4", "Joshua 1") and "Sermon on the Mount": 10 members (reader-e to reader-m) on 6
references in every state, so Who's where scrolls sideways
(`"/(tabs)/(library)/shared/seed-sermon-mount" --as reader-c`).

After `npm run db:reset`: `npm run sim -- flow shared-progress` (the seeded Romans 8 as Cara and
Dana: the header, Group counts, the people line opens the member list, the menu's Details and the
progress line Who's where, Cara makes Dana an editor, Dana adds Romans 8:31, Cara sees it);
`npm run sim -- flow shared-grid` (Dana opens Who's where from the progress line: four states, your
column first, member list; Cara opens it by link and makes Dana an editor there);
`npm run sim -- flow shared-emblems` (the seeded group reads "Cara · 2 members", its script
masters and then engraves every square, "Engraved by everyone", Cara deletes for everyone and
Dana's copy reads "3 verses" with the engraved glyph, reader-a's Psalms "1 verse" with the check). Shots:
`npm run sim -- shot "/(tabs)/(library)" --as reader-c` (the card without an emblem),
`"/(tabs)/(library)/seed-romans-8" --as reader-c` and `"/(tabs)/(library)/shared-cccccccc-0000-4000-8000-000000000031" --as reader-d`;
Who's where at `"/(tabs)/(library)/shared/seed-romans-8" --as reader-c` and
`"/(tabs)/(library)/shared/shared-cccccccc-0000-4000-8000-000000000031" --as reader-d`, light and dark.

## Decisions

- 2026-11-11 · Your own squares on the collection screen come from your local verses, the rest from the grid · Your row, review badge and the Group count then agree, and a session's result shows without a refetch.
- 2026-11-12 · Verse rows in a shared collection look like personal rows, with only the "mastered/members" count on the right; no You dot, no per-member bar, no Open filter and no Practice button · Caelan's phone pass: the dots confused, and a bar on some rows and a number on others read inconsistently.
- 2026-11-12 · The Group count is plain "10/10" even when everyone has it: no check, no colour · Caelan's pass 2 undid a check-and-colour state ("What it had before was fine").
- 2026-11-12 · Who's where is titled "Details", like the group card's link · Caelan: the name was too many words.
- 2026-11-11 · Who's where puts your column first and lists references in Bible order · You look for yourself first; the collection screen keeps your own sort, the grid is a fixed table.
- 2026-11-12 · Who's where reads the collection screen's grid and opens from the header's progress line and the menu's Details · One read path; the group card it used to open from folded into the header (pass 3).
- 2026-11-12 · The group card and invite card fold into the collection header; the gear goes, person-plus and the dots take its actions · Caelan approved the pass 3 mock-up: one header for solo and shared, actions as icons.
- 2026-11-11 · Column headers carry only the initial, mastered counts sit in a row under the tiles, and roles show in the member list · A role badge and a count don't fit a 26 pt column.
- 2026-11-11 · Learning is solid `warning`, not 30% alpha · The alpha tint turned brown on dark and read as a darker Engraved.
- 2026-11-11 · Your column is marked by a solid `primary` circle, not a caption · One marker, no extra row, the same mark on the group card and the member rows.
- 2026-11-11 · Columns keep a fixed 26 pt pitch and scroll from the measured width · Stretched columns spread a two-member grid across the card, and a member-count cutoff overlapped columns beside long references.
- 2026-11-12 · Done collections keep their own icon; mastered adds a check to the subtitle, engraved fills the square like the engraved verse pill; no ring, the same on personal and shared cards · Caelan's phone pass: the swapped check or cross lost the collection's identity, and the green square and ring read as a highlight. Replaces the emblem square and ring of 2026-11-11.
- 2026-11-12 · A shared card without the emblem reads "<owner's name> · M members" instead of the verse count, like the group card · Shared and personal collections read differently at a glance, and Caelan's pass 2 wanted the owner's name in place of "Shared"; the verse count is on the group card. A collection only its owner is in reads as personal (its verse count), even with a code out.
- 2026-11-12 · Before anyone joins, the owner's collection header shows the code where the people line goes · Caelan's pass 2: the code must be findable inside the collection, not only from Share again.
- 2026-11-12 · A joined group's owner name comes from `get_shared_members`, one read per joined group on each Library load (20 at most) · No schema change while the branch's migration is on testers' databases. If it ever costs, add the owner's name to `get_shared_status`.
- 2026-11-12 · Mastered and engraved move off the card's subtitle to a badge on the icon's corner, with a gold wash on engraved cards (a green wash on mastered cards was tried and dropped: it read as a status banner); the subtitle keeps "N verses" or "<owner> · M members", and no card says "by everyone" · Caelan's pass 4 (C25): one place for status, the same on shared and personal cards. Replaces the subtitle check of the decision above; the engraved square stays.
