# Home and Verse of the Month

> **Status: Living document.** Update when the Home tab content
> changes or when the VOTM mechanism (table, image, mastery count)
> changes. Read before touching `app/(tabs)/home.tsx`,
> `components/home/`, `lib/api/votm.ts`, or migrations 007/008.

The Home tab is the app's landing page. It shows the **Verse of the
Month** (a global monthly challenge) and a slim **InsightsCard**
shortcut to the full Insights tab.

## Layout

`app/(tabs)/home.tsx`:

```
┌─────────────────────────────────┐
│ App header                      │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ Verse of the Month          │ │
│ │ [Optional cover image]      │ │
│ │ Reference + verse text      │ │
│ │ "X people have memorized"   │ │
│ │ "Start" or "Mastered ✓"     │ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ InsightsCard                │ │
│ │ Streak + counts → Insights  │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

Default tab — set via `unstable_settings.anchor: 'home'` in
`(tabs)/_layout.tsx`.

## VOTM data flow

```
home.tsx mount or bibleVersion change
  │
  ▼
getCurrentVOTM()                              [lib/api/votm.ts]
  yearMonth = new Date YYYY-MM (local time)
  SELECT * FROM verse_of_month WHERE year_month = yearMonth
  → returns one row or null
  │
  ▼
Parallel:
  ├── getVOTMMasteryCount(votm)              [calls RPC get_votm_mastery_count]
  ├── hasUserMasteredVOTM(votm)              [SELECT 1 FROM user_verses ...]
  └── getVerseText(votm, defaultVersion)     [Bible API — see bible-api-and-caching.md]
  │
  ▼
Render VOTMCard with combined data
```

Loading state: skeleton placeholder. No-VOTM state: "Check back next
month!" message.

## `verse_of_month` table

Migration: `007_verse_of_month.sql` + `008_votm_image.sql`.

| Column | Notes |
|---|---|
| `id` | UUID PK |
| `year_month` | TEXT, format `"YYYY-MM"`, unique |
| `book`, `chapter`, `verse_start`, `verse_end` | The reference |
| `image_url` | TEXT, nullable — optional cover image |
| `created_at` | |

RLS: SELECT for anyone (anon and authenticated). No
INSERT/UPDATE/DELETE policy — admin populates via the Supabase
dashboard or service-role API.

**The VOTM has no version column.** It's rendered in the user's
current `bibleVersion`. Mastery counts ignore version too — see
below.

## Mastery counting

The VOTMCard shows "X people have memorized this verse." Source:

```ts
getVOTMMasteryCount(votm)
  → supabase.rpc('get_votm_mastery_count', {
      p_book, p_chapter, p_verse_start, p_verse_end
    })
  → returns number
```

**The `get_votm_mastery_count` SQL function is referenced but not
defined in any migration.** This is a real bug — calling it from
the running app will throw at runtime. Until a migration defines
it, the count won't render and the home screen will likely show an
error toast or skip the count.

The expected definition (per `lib/api/votm.ts` usage):

```sql
CREATE OR REPLACE FUNCTION get_votm_mastery_count(
  p_book TEXT, p_chapter INT, p_verse_start INT, p_verse_end INT
) RETURNS INT
LANGUAGE SQL STABLE
AS $$
  SELECT COUNT(DISTINCT user_id)::INT
  FROM user_verses
  WHERE book = p_book
    AND chapter = p_chapter
    AND verse_start = p_verse_start
    AND verse_end = p_verse_end
    AND (progress->'hard'->>'completed')::boolean = true;
$$;
```

(Version-agnostic on purpose — mastering John 3:16 in any
translation counts.)

## "Has the user mastered it?"

```ts
hasUserMasteredVOTM(votm)
  → supabase
      .from('user_verses')
      .select('id')
      .eq(book, chapter, verse_start, verse_end)
      .eq('progress->hard->>completed', 'true')
      .limit(1)
      .maybeSingle()
  → boolean
```

Same range-only matching, version-agnostic.

## VOTM image

`image_url` (added in migration 008) is an optional cover image
for the month. When present, `VOTMCard` renders it as a background
with an overlay; text switches to white for contrast. When absent,
it's a normal text card.

The image lives in Supabase Storage (a bucket like `votm-images`,
referenced in the migration comment). The URL is whatever URL the
admin enters when creating the row.

## Components

| File | Purpose |
|---|---|
| `components/home/VOTMCard.tsx` | The big VOTM card with image, text, mastery count |
| `components/home/InsightsCard.tsx` | Slim insights shortcut (streak + counts) |
| `app/(tabs)/home.tsx` | Composes the two cards |

## Tapping the VOTM card

Navigates to the verse-add flow (or the setup screen if already
saved) so the user can start memorizing it. The exact target
depends on whether the verse is already in the user's collections.

## Invariants

1. **VOTM is keyed by `year_month` in `"YYYY-MM"` format**, computed
   from the user's local clock. Don't switch to UTC without
   thinking through the rollover hour.
2. **VOTM has no version dimension.** The reference is what's
   global; the rendered translation follows the user's current
   `bibleVersion`. Mastery counts cross versions.
3. **`verse_of_month` is admin-write only.** No client should ever
   try to insert. RLS doesn't have an INSERT policy at all.
4. **`get_votm_mastery_count` must remain version-agnostic.** Don't
   add a version filter — that defeats the "everyone working on the
   same verse" framing.

## Sharp edges

- **`get_votm_mastery_count` SQL function is missing.** The client
  calls it but no migration defines it. This will throw at runtime
  the moment a user opens Home with a VOTM in place. Add a
  migration before relying on the count.
- **No fallback if the user's selected version doesn't have the
  verse.** `getVerseText` will return whatever the version
  produces; an empty result will render an empty card.
- **No image-URL validation.** If the admin enters a broken URL,
  the card silently falls back to text-only.
- **No "tomorrow's VOTM" preview.** The query is `year_month =
  current month` only. Around midnight on the last day of the
  month there's a brief window where the new VOTM hasn't loaded
  yet.
