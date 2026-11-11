-- One translation per account. Old clients never read this table.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  translation text check (translation ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Owners read their profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create their profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners update their profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.profiles from anon;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at_column();

-- Words mastered count a verse once per reference: switching translation keeps a verse,
-- so attempts in two versions are one verse. Same body as 011 without version in the keys.
create or replace function public.update_user_stats()
returns void
language plpgsql
security definer
as $$
declare
  min_words int;
begin
  select value::int into min_words from app_config where key = 'stats_min_words';
  if min_words is null then min_words := 600; end if;

  insert into user_stats (user_id, total_words_mastered, updated_at)
  select
    user_id,
    coalesce(sum(word_count), 0) as total_words,
    now()
  from (
    select distinct on (user_id, book, chapter, verse_start, verse_end)
      user_id,
      word_count
    from session_attempts
    where difficulty = 'hard' and accuracy >= 90 and word_count is not null
    order by user_id, book, chapter, verse_start, verse_end, created_at
  ) first_masteries
  group by user_id
  on conflict (user_id) do update set
    total_words_mastered = excluded.total_words_mastered,
    updated_at = now();

  with mastery_points as (
    select distinct on (user_id, book, chapter, verse_start, verse_end)
      user_id,
      book, chapter, verse_start, verse_end,
      created_at as mastery_time,
      word_count
    from session_attempts
    where difficulty = 'hard' and accuracy >= 90
    order by user_id, book, chapter, verse_start, verse_end, created_at
  ),
  verse_times as (
    select
      m.user_id,
      m.book, m.chapter, m.verse_start, m.verse_end,
      m.word_count,
      sum(a.recording_duration_ms) as total_time
    from mastery_points m
    join session_attempts a on
      a.user_id = m.user_id
      and a.book = m.book
      and a.chapter = m.chapter
      and a.verse_start = m.verse_start
      and a.verse_end = m.verse_end
      and a.created_at <= m.mastery_time
    where m.word_count is not null and m.word_count > 0
    group by m.user_id, m.book, m.chapter, m.verse_start, m.verse_end, m.word_count
  ),
  user_averages as (
    select
      user_id,
      avg(total_time::float / word_count) as avg_time_per_word
    from verse_times
    group by user_id
  )
  update user_stats s
  set
    avg_time_per_word_ms = ua.avg_time_per_word,
    updated_at = now()
  from user_averages ua
  where s.user_id = ua.user_id
    and s.total_words_mastered >= min_words;
end;
$$;
