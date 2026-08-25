-- Remember the last study setup (chunk size + difficulty) per verse.
-- Written by the new client when a session starts; the setup screen
-- restores them on next open. Additive-only: old clients never
-- reference these columns, so they stay NULL until a new client
-- writes them, and old-client reads/writes are unaffected.

ALTER TABLE user_verses
  ADD COLUMN IF NOT EXISTS last_chunk_size INT
    CHECK (last_chunk_size IS NULL OR last_chunk_size >= 1),
  ADD COLUMN IF NOT EXISTS last_difficulty TEXT
    CHECK (last_difficulty IS NULL OR last_difficulty IN ('easy', 'medium', 'hard'));
