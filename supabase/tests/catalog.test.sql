-- Catalog rules every app must keep. Run by `npm run test:db`.
-- To allow a function, add its signature as the failure prints it to the allowlist below, with why, e.g.
--   ('is_admin()'), -- used inside RLS policies
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select is(
  array(
    select c.oid::regclass::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by 1
  ),
  array[]::text[],
  'every public table has RLS on'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.oid::regprocedure::text not in (
        -- allowlist: one signature per line, with why
        select sig from (values
          ('delete_own_account()'), -- the client calls it; it only ever acts on auth.uid()
          ('get_current_streak(uuid,integer)'), -- the client calls it; known bug in access.test.sql: it takes any user's id
          ('get_total_time_studied(uuid)'), -- same as above
          ('update_popular_ranges()'), -- cron only; known bug in access.test.sql: clients can call it too
          ('update_user_stats()') -- same as above
        ) as allowlist(sig)
      )
    order by 1
  ),
  array[]::text[],
  'no SECURITY DEFINER function in public is executable by anon or authenticated, unless allowlisted'
);

select * from finish();
rollback;
