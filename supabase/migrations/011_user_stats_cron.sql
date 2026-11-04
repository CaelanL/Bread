-- User stats table for precomputed analytics
-- Updated daily via cron job

CREATE TABLE user_stats (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  avg_time_per_word_ms DECIMAL,          -- Average ms to master 1 word
  total_words_mastered INT DEFAULT 0,    -- For filtering (only compute for users with 600+ words)
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own stats"
  ON user_stats FOR SELECT
  USING (auth.uid() = user_id);

-- Configuration table for cron settings
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default: run every 6 hours
INSERT INTO app_config (key, value) VALUES ('stats_cron_schedule', '0 */6 * * *')
ON CONFLICT (key) DO NOTHING;

-- Minimum words mastered to compute stats
INSERT INTO app_config (key, value) VALUES ('stats_min_words', '600')
ON CONFLICT (key) DO NOTHING;

-- Function to calculate and update user stats
CREATE OR REPLACE FUNCTION update_user_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  min_words INT;
BEGIN
  -- Get minimum words threshold from config
  SELECT value::INT INTO min_words FROM app_config WHERE key = 'stats_min_words';
  IF min_words IS NULL THEN min_words := 600; END IF;

  -- First, update total_words_mastered for all users
  INSERT INTO user_stats (user_id, total_words_mastered, updated_at)
  SELECT
    user_id,
    COALESCE(SUM(word_count), 0) as total_words,
    NOW()
  FROM (
    -- Get first mastery attempt per verse (to count each verse once)
    SELECT DISTINCT ON (user_id, book, chapter, verse_start, verse_end, version)
      user_id,
      word_count
    FROM session_attempts
    WHERE difficulty = 'hard' AND accuracy >= 90 AND word_count IS NOT NULL
    ORDER BY user_id, book, chapter, verse_start, verse_end, version, created_at
  ) first_masteries
  GROUP BY user_id
  ON CONFLICT (user_id) DO UPDATE SET
    total_words_mastered = EXCLUDED.total_words_mastered,
    updated_at = NOW();

  -- Now calculate avg_time_per_word for users with enough words
  WITH mastery_points AS (
    -- Find first mastery attempt per verse per user
    SELECT DISTINCT ON (user_id, book, chapter, verse_start, verse_end, version)
      user_id,
      book, chapter, verse_start, verse_end, version,
      created_at as mastery_time,
      word_count
    FROM session_attempts
    WHERE difficulty = 'hard' AND accuracy >= 90
    ORDER BY user_id, book, chapter, verse_start, verse_end, version, created_at
  ),
  verse_times AS (
    -- Sum all attempts up to mastery for each verse
    SELECT
      m.user_id,
      m.book, m.chapter, m.verse_start, m.verse_end, m.version,
      m.word_count,
      SUM(a.recording_duration_ms) as total_time
    FROM mastery_points m
    JOIN session_attempts a ON
      a.user_id = m.user_id
      AND a.book = m.book
      AND a.chapter = m.chapter
      AND a.verse_start = m.verse_start
      AND a.verse_end = m.verse_end
      AND a.version = m.version
      AND a.created_at <= m.mastery_time
    WHERE m.word_count IS NOT NULL AND m.word_count > 0
    GROUP BY m.user_id, m.book, m.chapter, m.verse_start, m.verse_end, m.version, m.word_count
  ),
  user_averages AS (
    SELECT
      user_id,
      AVG(total_time::float / word_count) as avg_time_per_word
    FROM verse_times
    GROUP BY user_id
  )
  UPDATE user_stats s
  SET
    avg_time_per_word_ms = ua.avg_time_per_word,
    updated_at = NOW()
  FROM user_averages ua
  WHERE s.user_id = ua.user_id
    AND s.total_words_mastered >= min_words;

END;
$$;

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the job (default: every 6 hours)
-- Note: You can update the schedule by changing app_config and re-running this
SELECT cron.schedule(
  'update-user-stats',
  '0 */6 * * *',  -- Every 6 hours
  'SELECT update_user_stats()'
);
