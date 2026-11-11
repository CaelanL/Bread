-- Monthly artwork as plain public URLs, so it never expires. Rows that already have art keep it.
-- Updates nothing locally, where the images bucket does not exist.
update storage.buckets set public = true where id = 'images';

-- Alternates from 2026-11 (gold trees) through the seeded range ending 2036-10.
update public.verse_of_month
set image_url = 'https://bhvvagvnmoxpjgfffgpl.supabase.co/storage/v1/object/public/images/'
  || case when (left(year_month, 4)::int * 12 + right(year_month, 2)::int - (2026 * 12 + 11)) % 2 = 0
    then 'vtm-gold-trees.png' else 'vtm-dark-sky.png' end
where image_url is null
  and year_month ~ '^\d{4}-\d{2}$'
  and year_month between '2026-11' and '2036-10';
