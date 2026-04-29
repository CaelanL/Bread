-- Migration: Notification system fixups (post-017 chunk-1 review)
--
-- 017 shipped to prod, then a code review surfaced two real issues:
--
-- 1. The edge function's intended `.schema("vault").from("decrypted_secrets")`
--    pattern does not work in Supabase Cloud. PostgREST enforces a
--    schema allowlist (db.schemas) that service_role does NOT bypass,
--    AND service_role has no SELECT grant on vault.decrypted_secrets
--    by default. Authoritative answer in
--    https://github.com/orgs/supabase/discussions/21096 and the
--    vault extension's own install SQL (no GRANTs to service_role).
--
--    Fix: a SECURITY DEFINER RPC in the public schema, with EXECUTE
--    granted to service_role only. The function reads from
--    vault.decrypted_secrets as its owner (postgres) and returns the
--    secret value to the caller.
--
-- 2. local_time_in_tz() was marked IMMUTABLE but calls now(), which
--    is STABLE. IMMUTABLE asserts to the planner that the result
--    depends only on inputs — letting it fold/cache across rows or
--    even across queries. STABLE is the correct marker (constant
--    within a single statement, can change between statements).
--
-- Both fixes are additive/replacement only — no schema changes, no
-- impact on old or new clients.

-- ─── Fix 1: SECURITY DEFINER RPC for cron secret ────────────────
CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  s text;
BEGIN
  SELECT decrypted_secret INTO s
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret';
  RETURN s;
END;
$$;

REVOKE ALL ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO service_role;

-- ─── Fix 2: local_time_in_tz volatility ─────────────────────────
CREATE OR REPLACE FUNCTION local_time_in_tz(tz text)
RETURNS timestamp LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN now() AT TIME ZONE tz;
EXCEPTION WHEN others THEN
  RETURN now() AT TIME ZONE 'UTC';
END;
$$;
