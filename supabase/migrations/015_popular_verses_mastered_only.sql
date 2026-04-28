-- Re-define update_popular_ranges() to count only MASTERED verses.
--
-- Migration 010 originally counted every verse anyone had added. The live
-- prod function was hand-edited at some point to filter on
-- `hard.completed = true` (the correct behavior for "Popular Verses"),
-- but the migration file was never updated to match. This migration
-- brings the file in line with prod so a fresh DB build produces the
-- correct function from the start.
--
-- Behavioral notes:
--   - Resetting progress on a previously-mastered verse drops the user's
--     contribution to that range on the next cron pass (every 12h).
--   - Soft-deleted but-still-mastered verses still count, because they
--     were mastered. Mastery is permanent in this app's data model.
--   - This migration only redefines the function. The next scheduled cron
--     pass refreshes the table; we also call it once at the bottom so the
--     table reflects the new logic immediately.

CREATE OR REPLACE FUNCTION update_popular_ranges()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  TRUNCATE popular_ranges;

  INSERT INTO popular_ranges (book, chapter, verse_start, verse_end, user_count, updated_at)
  SELECT
    book,
    chapter,
    s AS verse_start,
    e AS verse_end,
    COUNT(DISTINCT user_id) AS user_count,
    now() AS updated_at
  FROM user_verses,
    generate_series(verse_start, verse_end) AS s,
    generate_series(verse_start, verse_end) AS e
  WHERE e >= s
    AND (progress->'hard'->>'completed')::boolean = true
  GROUP BY book, chapter, s, e
  HAVING COUNT(DISTINCT user_id) >= 1
  ORDER BY user_count DESC
  LIMIT 1000;
END;
$$;

-- Run once now so the table reflects the corrected definition immediately,
-- without waiting up to 12 hours for the next cron pass.
SELECT update_popular_ranges();
