-- Policies and grants only. Every drop, change and revoke checks that its object exists, since
-- prod may predate some of them (docs/architecture/data-model.md). Safe for old clients: each
-- owner policy keeps its meaning; only the linking check is tighter (a verse may only be put in
-- one's own collection, which every client already does).
do $$
declare
  r record;
begin
  -- The service role bypasses RLS, so these only added a check to every user's query.
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and policyname like 'Service role can manage %'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  -- auth.uid() in a sub-select runs once per query, not once per row; signed-in users only.
  for r in
    select * from (values
      ('device_tokens', 'users own their tokens', '(select auth.uid()) = user_id', null),
      ('notification_log', 'users read their own log', '(select auth.uid()) = user_id', null),
      ('notification_preferences', 'users own their prefs', '(select auth.uid()) = user_id', null),
      ('session_attempts', 'Users can insert own attempts', null, '(select auth.uid()) = user_id'),
      ('session_attempts', 'Users can view own attempts', '(select auth.uid()) = user_id', null),
      ('subscriptions', 'Users can view own subscription', '(select auth.uid()) = user_id', null),
      ('usage_daily', 'Users can view own usage', '(select auth.uid()) = user_id', null),
      ('user_collections', 'Users can insert own collections', null, '(select auth.uid()) = user_id'),
      ('user_collections', 'Users can update own collections', '(select auth.uid()) = user_id', null),
      ('user_collections', 'Users can view own collections', '(select auth.uid()) = user_id', null),
      ('user_stats', 'Users can view own stats', '(select auth.uid()) = user_id', null),
      ('user_verses', 'Users can insert own verses', null, '(select auth.uid()) = user_id'),
      ('user_verses', 'Users can update own verses', '(select auth.uid()) = user_id', null),
      ('user_verses', 'Users can view own verses', '(select auth.uid()) = user_id', null),
      ('verse_collections', 'Users can delete own verse_collections',
        'exists (select 1 from public.user_verses as v where v.id = verse_collections.verse_id and v.user_id = (select auth.uid()))', null),
      ('verse_collections', 'Users can view own verse_collections',
        'exists (select 1 from public.user_verses as v where v.id = verse_collections.verse_id and v.user_id = (select auth.uid()))', null),
      ('verse_collections', 'Users can insert own verse_collections', null,
        'exists (select 1 from public.user_verses as v where v.id = verse_collections.verse_id and v.user_id = (select auth.uid()))'
        || ' and exists (select 1 from public.user_collections as c where c.id = verse_collections.collection_id and c.user_id = (select auth.uid()))')
    ) as policy(tbl, name, using_sql, check_sql)
  loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.name) then
      execute format('alter policy %I on public.%I to authenticated', r.name, r.tbl)
        || case when r.using_sql is null then '' else format(' using (%s)', r.using_sql) end
        || case when r.check_sql is null then '' else format(' with check (%s)', r.check_sql) end;
    end if;
  end loop;

  if to_regclass('public.transcription_locks') is not null then
    revoke all on public.transcription_locks from anon, authenticated;
  end if;
  revoke all on public.user_collections from anon;

  -- Legacy cache and lock functions: no caller in this repo. The service role keeps its grant.
  for r in
    select to_regprocedure(sig) as fn from unnest(array[
      'public.cleanup_stale_transcription_locks()',
      'public.cleanup_expired_verse_cache()',
      'public.get_verse_cache_count(text)',
      'public.evict_lru_verses(text,integer,integer)',
      'public.upsert_verses(text,integer,text,jsonb)'
    ]) as sig
  loop
    if r.fn is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    end if;
  end loop;
end;
$$;
