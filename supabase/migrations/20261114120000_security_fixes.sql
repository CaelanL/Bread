-- Security fixes (docs/architecture/data-model.md). Old clients keep working: they call the stats
-- functions with their own id and get the same numbers.

-- The stats functions answered for any user id. Now they run as the caller, under RLS, and answer
-- only for the caller: another id counts nothing.
create or replace function public.get_total_time_studied(p_user_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(a.recording_duration_ms), 0)::bigint
  from public.session_attempts as a
  where a.user_id = p_user_id and p_user_id = (select auth.uid());
$$;

-- p_tz_offset_min: the client's timezone offset in minutes (JavaScript's sign, e.g. 300 for EST).
create or replace function public.get_current_streak(p_user_id uuid, p_tz_offset_min integer)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  practice_dates date[];
  today date;
  yesterday date;
  streak int := 0;
  i int;
  tz_interval interval;
begin
  tz_interval := (p_tz_offset_min * -1) * interval '1 minute';
  today := (now() + tz_interval)::date;
  yesterday := today - 1;

  select array_agg(distinct (a.created_at + tz_interval)::date order by (a.created_at + tz_interval)::date desc)
  into practice_dates
  from public.session_attempts as a
  where a.user_id = p_user_id and p_user_id = (select auth.uid());

  if practice_dates is null or array_length(practice_dates, 1) is null then
    return 0;
  end if;
  if practice_dates[1] != today and practice_dates[1] != yesterday then
    return 0;
  end if;

  streak := 1;
  for i in 2..array_length(practice_dates, 1) loop
    if practice_dates[i - 1] - practice_dates[i] = 1 then
      streak := streak + 1;
    else
      exit;
    end if;
  end loop;
  return streak;
end;
$$;

revoke execute on function public.get_total_time_studied(uuid) from public, anon;
revoke execute on function public.get_current_streak(uuid, integer) from public, anon;
grant execute on function public.get_total_time_studied(uuid) to authenticated;
grant execute on function public.get_current_streak(uuid, integer) to authenticated;

-- Cron-only: pg_cron runs them as their owner. A pinned search_path for the definer bodies.
do $$
declare
  fn regprocedure;
begin
  foreach fn in array array[to_regprocedure('public.update_popular_ranges()'), to_regprocedure('public.update_user_stats()')] loop
    if fn is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
      execute format('alter function %s set search_path = public', fn);
    end if;
  end loop;
end;
$$;

-- Its body already names every schema. Signed-in users only.
alter function public.delete_own_account() set search_path = '';
revoke execute on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- The only user table whose rows blocked deleting their user (from the dashboard or the admin API).
alter table public.session_attempts drop constraint if exists session_attempts_user_id_fkey;
alter table public.session_attempts add constraint session_attempts_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade not valid;
alter table public.session_attempts validate constraint session_attempts_user_id_fkey;

-- Plain indexes on the same columns as a unique constraint's index: every write kept both.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('idx_usage_daily_user_date', 'usage_daily_user_id_date_key'),
      ('idx_user_collections_client', 'user_collections_user_id_client_id_key'),
      ('idx_user_verses_client', 'user_verses_user_id_client_id_key'),
      ('idx_votm_year_month', 'verse_of_month_year_month_key')
    ) as pair(duplicate, kept)
  loop
    if to_regclass('public.' || r.kept) is not null then
      execute format('drop index if exists public.%I', r.duplicate);
    end if;
  end loop;
end;
$$;
