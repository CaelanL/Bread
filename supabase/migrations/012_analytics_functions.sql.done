-- Analytics SQL functions for scalable queries
-- Instead of fetching all rows to client, calculate in database

-- Function to get total time studied (sum of all recording durations)
CREATE OR REPLACE FUNCTION get_total_time_studied(p_user_id UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT COALESCE(SUM(recording_duration_ms), 0)::BIGINT
  FROM session_attempts
  WHERE user_id = p_user_id;
$$;

-- Function to get current streak (consecutive days with practice)
-- p_tz_offset_min: client's timezone offset in minutes (e.g., -300 for EST)
-- This matches the original JS approach where new Date() converts UTC to local
CREATE OR REPLACE FUNCTION get_current_streak(p_user_id UUID, p_tz_offset_min INT)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  practice_dates DATE[];
  today DATE;
  yesterday DATE;
  streak INT := 0;
  i INT;
  tz_interval INTERVAL;
BEGIN
  -- Convert offset minutes to interval (negative because JS gives opposite sign)
  tz_interval := (p_tz_offset_min * -1) * INTERVAL '1 minute';

  -- Get today and yesterday in client's local time
  today := (NOW() + tz_interval)::DATE;
  yesterday := today - 1;

  -- Get distinct practice dates in client's local time, ordered descending
  SELECT ARRAY_AGG(DISTINCT (created_at + tz_interval)::DATE ORDER BY (created_at + tz_interval)::DATE DESC)
  INTO practice_dates
  FROM session_attempts
  WHERE user_id = p_user_id;

  -- No practice history
  IF practice_dates IS NULL OR array_length(practice_dates, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Check if most recent practice was today or yesterday
  IF practice_dates[1] != today AND practice_dates[1] != yesterday THEN
    RETURN 0;  -- Streak broken
  END IF;

  -- Count consecutive days
  streak := 1;
  FOR i IN 2..array_length(practice_dates, 1) LOOP
    IF practice_dates[i-1] - practice_dates[i] = 1 THEN
      streak := streak + 1;
    ELSE
      EXIT;  -- Gap found, stop counting
    END IF;
  END LOOP;

  RETURN streak;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_total_time_studied(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_streak(UUID, INT) TO authenticated;
