-- Records the hand edits made on prod after 20261117142523, so the migrations build what prod runs.
-- Every statement is a no-op or a same-result replace on prod's current state, except the drop of
-- get_tier_and_usage, which removes a live prod function.
-- destructive-ok: legacy transcription_locks table and 4 unused cache/lock functions already gone on prod; the truncate hit is VACUUM's TRUNCATE FALSE option in the cron command, not a statement, approved by Caelan 2026-11-21

-- Verse of the Month count, made by hand on prod; current and old builds call it (lib/api/votm.ts).
-- Same signature, result and grants as prod. Pinning search_path is the one change.
create or replace function public.get_votm_mastery_count(
  p_book text,
  p_chapter integer,
  p_verse_start integer,
  p_verse_end integer
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.user_verses
  where book = p_book
    and chapter = p_chapter
    and verse_start = p_verse_start
    and verse_end = p_verse_end
    and (progress->'hard'->>'completed')::boolean = true;
$$;

grant execute on function public.get_votm_mastery_count(text, integer, integer, integer) to anon, authenticated;

-- Prod-only, no caller, and it let any client read any user's tier and daily usage.
drop function if exists public.get_tier_and_usage(uuid, date, text);

-- Already dropped on prod. Unused since process-recording stopped taking locks (2026-01-16).
drop function if exists public.cleanup_stale_transcription_locks();
drop function if exists public.cleanup_expired_verse_cache();
drop function if exists public.get_verse_cache_count(text);
drop function if exists public.evict_lru_verses(text, integer, integer);
drop table if exists public.transcription_locks;

-- cron.schedule replaces a job of the same name, so both are idempotent.
select cron.schedule('update-popular-ranges', '0 * * * *', $$SELECT update_popular_ranges()$$);
-- The per-minute send-notifications call leaves a row in net._http_response each time.
select cron.schedule(
  'vacuum-pg-net-responses',
  '17 8 * * *',
  $$VACUUM (INDEX_CLEANUP ON, TRUNCATE FALSE, PARALLEL 0, SKIP_LOCKED TRUE) net._http_response$$
);
