-- First and last name behind profiles.display_name. The app writes all three together and
-- display_name stays what members see ("Caelan L."), so every reader of it is unchanged.
-- Reference: docs/architecture/auth.md#display-name.

alter table public.profiles
  add column first_name text check (first_name is null or length(btrim(first_name)) between 1 and 30),
  add column last_name text check (last_name is null or length(btrim(last_name)) between 1 and 30);

-- A name saved before this keeps working as the first name.
update public.profiles set first_name = left(btrim(display_name), 30)
where display_name is not null and first_name is null;
