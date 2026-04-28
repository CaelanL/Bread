-- Per-collection sort persistence + last-practiced timestamp.
--
-- See docs/features/library-sort-persistence-and-last-practiced.md
-- for the full design and decisions log.
--
-- Two additive columns. No backfill, no functions, no indexes.
-- Sorting happens client-side in JS on the in-memory verses array;
-- a DB index on last_practiced_at would be dead weight.

-- Per-collection sort preference. NULL = client default ('recent').
-- Old clients tolerate unknown columns on SELECT.
ALTER TABLE public.user_collections
ADD COLUMN sort_preference TEXT NULL
CHECK (sort_preference IN ('recent', 'alphabetical', 'mastery', 'due-first'));

COMMENT ON COLUMN public.user_collections.sort_preference IS
'Per-collection sort. NULL = client default. due-first applies to Mastered only.';

-- Last time the user practiced (completed any session, full or partial)
-- on this verse. Drives the "Recent" sort, which now means "last
-- practiced descending" rather than "added descending". Starts NULL
-- for all rows; populates organically via updateVerseProgress.
ALTER TABLE public.user_verses
ADD COLUMN last_practiced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.user_verses.last_practiced_at IS
'Updated whenever updateVerseProgress runs for any session completion (full or partial). NULL means never practiced — sorts after practiced verses under the Recent comparator.';
