-- Lock down server-side shared tables from direct PostgREST access.
-- Security Advisor: rls_disabled_in_public (verse_cache, app_config),
-- security_definer_view (verse_cache_stats).
--
-- These tables are written/read only by edge functions and cron via the
-- service role, which bypasses both RLS and these grants. Clients never
-- query them directly (all verse reads go through the bible edge
-- function), so this is safe for old clients.
--
-- RLS with zero policies = deny-all for anon/authenticated; the REVOKE
-- is belt-and-braces on top.

ALTER TABLE verse_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON verse_cache, app_config, verse_cache_stats FROM anon, authenticated;

-- Make the stats view run with the caller's permissions instead of the
-- view owner's, so it no longer bypasses the lockdown above.
ALTER VIEW verse_cache_stats SET (security_invoker = true);
