-- Migration: Add spaced-repetition review state to user_verses.progress.engraved
--
-- Replaces the calendar-month engraving streak with a per-verse SR schedule.
-- New SR fields (passCount, lifetimeReviews, nextDueAt, lastReviewedAt) are
-- added to the existing JSONB sub-object. The legacy `months` array is
-- preserved here for cross-client safety during the App Store rollout window;
-- a follow-up migration drops it once the new client is universally deployed.
--
-- Resulting transition shape:
--   {
--     completed:       boolean   (preserved from legacy; true if was true)
--     months:          string[]  (preserved — old clients still read this)
--     passCount:       number    (new — seeded from months.length, OR 10 if pre-engraved)
--     lifetimeReviews: number    (new — same seed as passCount)
--     nextDueAt:       null      (new — first new-client review will schedule)
--     lastReviewedAt:  null      (new — no month-precision data to seed from)
--   }
--
-- Critical seeding rule: rows with `completed: true` pre-migration (a fully
-- engraved verse with months.length === 4) MUST seed passCount >= 10 so the
-- new client's `completed = passCount >= ENGRAVED_THRESHOLD` derivation
-- preserves their engraved status. Production data audit (2026-04-27) shows
-- zero fully-engraved verses across all users, so this branch is defensive
-- but currently affects no rows.
--
-- Idempotent: re-running produces the same shape. Adds keys only.

UPDATE public.user_verses
SET progress = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        progress,
        '{engraved,passCount}',
        to_jsonb(
          CASE
            WHEN COALESCE((progress->'engraved'->>'completed')::boolean, false) = true
              THEN 10
            ELSE
              CASE
                WHEN jsonb_typeof(progress->'engraved'->'months') = 'array'
                  THEN jsonb_array_length(progress->'engraved'->'months')
                ELSE 0
              END
          END
        )
      ),
      '{engraved,lifetimeReviews}',
      to_jsonb(
        CASE
          WHEN COALESCE((progress->'engraved'->>'completed')::boolean, false) = true
            THEN 10
          ELSE COALESCE(jsonb_array_length(progress->'engraved'->'months'), 0)
        END
      )
    ),
    '{engraved,nextDueAt}',
    'null'::jsonb
  ),
  '{engraved,lastReviewedAt}',
  'null'::jsonb
)
WHERE progress ? 'engraved'
  AND jsonb_typeof(progress->'engraved') = 'object'
  AND NOT (progress->'engraved' ? 'passCount');

-- Rows with no `engraved` sub-object are left alone. The new client's
-- default-progress shape populates them on next write; both old and new
-- clients tolerate the absence of `engraved`.
