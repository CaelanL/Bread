-- A progress save that only lands on the row it was computed from. The app passes the
-- updated_at it last read; any other update since (another device, a reset) refuses the save
-- and hands back the current row, so the app recomputes from it and saves once more
-- (docs/features/review.md). Additive: old clients keep their plain update.
create function public.save_verse_progress(
  p_client_id text,
  p_expected_updated_at timestamptz,
  p_progress jsonb,
  p_last_practiced_at timestamptz
)
returns table (applied boolean, progress jsonb, last_practiced_at timestamptz, updated_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A null progress keeps the row's: the session set no new best.
  return query
  update public.user_verses as v
  set progress = coalesce(p_progress, v.progress), last_practiced_at = p_last_practiced_at
  where v.user_id = (select auth.uid()) and v.client_id = p_client_id and v.updated_at = p_expected_updated_at
  returning true, v.progress, v.last_practiced_at, v.updated_at;
  if found then
    return;
  end if;

  return query
  select false, v.progress, v.last_practiced_at, v.updated_at
  from public.user_verses as v
  where v.user_id = (select auth.uid()) and v.client_id = p_client_id;
end;
$$;

revoke execute on function public.save_verse_progress(text, timestamptz, jsonb, timestamptz) from public, anon;
grant execute on function public.save_verse_progress(text, timestamptz, jsonb, timestamptz) to authenticated;
