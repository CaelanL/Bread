create table public.user_intro_presentations (
  user_id uuid not null references auth.users(id) on delete cascade,
  intro_id text not null check (length(intro_id) between 1 and 80),
  claimed_at timestamptz not null default now(),
  primary key (user_id, intro_id)
);

alter table public.user_intro_presentations enable row level security;
revoke all on public.user_intro_presentations from public, anon, authenticated;
grant select, insert on public.user_intro_presentations to authenticated;
grant all on public.user_intro_presentations to service_role;

create policy "Owners read intro presentations"
  on public.user_intro_presentations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Owners claim intro presentations"
  on public.user_intro_presentations for insert to authenticated
  with check ((select auth.uid()) = user_id);

create function public.claim_intro_presentation(p_intro_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_intro_id is null or length(p_intro_id) not between 1 and 80 then
    raise exception 'Invalid intro ID' using errcode = '22023';
  end if;
  insert into public.user_intro_presentations(user_id, intro_id)
  values (auth.uid(), p_intro_id)
  on conflict (user_id, intro_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end;
$$;

revoke all on function public.claim_intro_presentation(text) from public, anon;
grant execute on function public.claim_intro_presentation(text) to authenticated;
