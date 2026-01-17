-- Popular Ranges: Track most memorized verse ranges across all users
-- Precomputed table updated by cron job
--
-- Logic: If a user has John 3:1-16, they contribute +1 to every sub-range:
--   John 3:1, John 3:1-2, John 3:1-3, ... John 3:1-16,
--   John 3:2, John 3:2-3, ... John 3:2-16,
--   ... all the way to John 3:16
-- Each user can only contribute +1 per range (even if multiple saved verses overlap)

-- Table to store popular range counts
CREATE TABLE popular_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book TEXT NOT NULL,
  chapter INT NOT NULL,
  verse_start INT NOT NULL,
  verse_end INT NOT NULL,
  user_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(book, chapter, verse_start, verse_end)
);

-- Index for sorting by popularity
CREATE INDEX idx_popular_ranges_count ON popular_ranges(user_count DESC);

-- RLS: Anyone can read, only service role can write
ALTER TABLE popular_ranges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read popular ranges" ON popular_ranges FOR SELECT USING (true);

-- Function to update popular ranges
-- For each user_verse, generates all possible sub-ranges
-- Then counts distinct users per range
-- Includes soft-deleted verses (deleted_at IS NOT NULL still counts)
CREATE OR REPLACE FUNCTION update_popular_ranges()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Clear existing data
  TRUNCATE popular_ranges;

  -- Insert aggregated counts
  -- For each user_verse, generate all sub-ranges using two generate_series calls
  -- s = sub-range start (from verse_start to verse_end)
  -- e = sub-range end (from s to verse_end)
  -- Then count distinct users per (book, chapter, verse_start, verse_end)
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
  WHERE e >= s  -- end must be >= start
  GROUP BY book, chapter, s, e
  HAVING COUNT(DISTINCT user_id) >= 1
  ORDER BY user_count DESC
  LIMIT 1000;  -- Store top 1000, display top 10
END;
$$;

-- Schedule cron job to run every 12 hours
SELECT cron.schedule(
  'update-popular-ranges',
  '0 */12 * * *',
  $$SELECT update_popular_ranges()$$
);

-- Run initial population
SELECT update_popular_ranges();
