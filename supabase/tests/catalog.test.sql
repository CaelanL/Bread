-- Catalog rules every app must keep. Run by `npm run test:db`.
-- To allow a function, add its signature as the failure prints it to the allowlist below, with why, e.g.
--   ('is_admin()'), -- used inside RLS policies
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

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
          ('get_votm_mastery_count(text,integer,integer,integer)'), -- Home calls it signed in or not; it returns only a count
          ('register_device_token(text,text)') -- the client calls it; it only ever writes rows for auth.uid()
        ) as allowlist(sig)
      )
    order by 1
  ),
  array[]::text[],
  'no SECURITY DEFINER function in public is executable by anon or authenticated, unless allowlisted'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not exists (select 1 from unnest(p.proconfig) as c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1
  ),
  array[]::text[],
  'every SECURITY DEFINER function in public and private pins its search_path'
);

select is(
  array(
    select c.relname || '.' || p.policyname
    from pg_policies p
    join pg_class c on c.relname = p.tablename
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
    where p.schemaname = 'public' and p.policyname like 'Service role can manage%'
    order by 1
  ),
  array[]::text[],
  'no "Service role can manage" policies: the service role bypasses RLS'
);

select is(
  array(
    select p.tablename || '.' || p.policyname
    from pg_policies p
    where p.schemaname = 'public'
      and (replace(coalesce(p.qual, ''), '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%'
        or replace(coalesce(p.with_check, ''), '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%')
    order by 1
  ),
  array[]::text[],
  'every public policy calls auth.uid() in a sub-select, once per query'
);

select is(
  array(
    select i.indrelid::regclass::text || ': ' || string_agg(i.indexrelid::regclass::text, ', ' order by i.indexrelid::regclass::text)
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
    group by i.indrelid, i.indkey::text, i.indclass::text,
      coalesce(pg_get_expr(i.indexprs, i.indrelid), ''), coalesce(pg_get_expr(i.indpred, i.indrelid), '')
    having count(*) > 1
    order by 1
  ),
  array[]::text[],
  'no two indexes on one public table cover the same columns'
);

select is(
  array(
    select conrelid::regclass::text
    from pg_constraint
    where contype = 'f' and confrelid = 'auth.users'::regclass
      and connamespace = 'public'::regnamespace
      and confdeltype not in ('c', 'n')
    order by 1
  ),
  array[]::text[],
  'every public table''s user foreign key cascades or sets null, so a user can be deleted'
);

select * from finish();
rollback;
