-- Feedback: grading reports from the result card and general feedback from Settings, with up to
-- five photos. Clients may only insert; reports are read in the dashboard. docs/features/feedback.md.
-- Additive: a new table, bucket, policy, function and cron job, so old clients are unaffected.
-- The limits match FEEDBACK_LIMITS in lib/feedback/index.ts. Clients set `id`, kept across retries,
-- so the primary key stops a retry from saving one report twice.

create table public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('grading', 'general')),
  label text check (label in ('idea', 'bug', 'other')),
  note text not null check (btrim(note) <> '' and char_length(note) <= 4000),
  details jsonb check (octet_length(details::text) <= 262144),
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 5),
  app_version text check (char_length(app_version) <= 100),
  update_id text check (char_length(update_id) <= 100),
  os text check (char_length(os) <= 100),
  os_version text check (char_length(os_version) <= 100),
  device_model text check (char_length(device_model) <= 100),
  created_at timestamptz not null default now()
);

create index idx_feedback_reports_user on public.feedback_reports (user_id);

alter table public.feedback_reports enable row level security;
revoke all on public.feedback_reports from public, anon, authenticated;
grant insert on public.feedback_reports to authenticated;
grant all on public.feedback_reports to service_role;

-- No select, update or delete for clients. Photo paths must sit in the caller's own folder.
create policy "Owners send feedback"
  on public.feedback_reports for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and not exists (
      select 1 from unnest(photo_paths) as path
      where split_part(path, '/', 1) <> (select auth.uid())::text
    )
  );

-- Private photos: 50 MB, images only. Clients upload under <their id>/ and can't read or list.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-photos', 'feedback-photos', false, 52428800, array['image/*'])
on conflict (id) do nothing;

create policy "Owners upload feedback photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'feedback-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Restrictive, so a broad dashboard policy on storage.objects (prod has some we can't see) can't
-- open this bucket: clients never read, change or delete its photos, and insert only as above.
-- Other buckets are untouched.
create policy "Feedback photos stay unreadable"
  on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id is distinct from 'feedback-photos');

create policy "Feedback photos stay unchanged"
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id is distinct from 'feedback-photos')
  with check (bucket_id is distinct from 'feedback-photos');

create policy "Feedback photos stay undeleted"
  on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id is distinct from 'feedback-photos');

create policy "Feedback photos only in your folder"
  on storage.objects as restrictive for insert to anon, authenticated
  with check (
    bucket_id is distinct from 'feedback-photos'
    or (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Photos whose account is gone, for the delete-feedback-photos function. Storage refuses SQL
-- deletes and would keep the bytes, so the function removes them through the Storage API.
create function public.orphaned_feedback_photos()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects as o
  where o.bucket_id = 'feedback-photos'
    and not exists (select 1 from auth.users as u where u.id::text = split_part(o.name, '/', 1))
  order by o.name
  limit 1000;
$$;

revoke all on function public.orphaned_feedback_photos() from public, anon, authenticated;
grant execute on function public.orphaned_feedback_photos() to service_role;

-- Daily. The local seed unschedules it, as it does every job that calls the prod URL.
select cron.schedule(
  'delete-feedback-photos',
  '30 4 * * *',
  $$ select net.http_post(
       url := 'https://bhvvagvnmoxpjgfffgpl.supabase.co/functions/v1/delete-feedback-photos',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' ||
            (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     ); $$
);
