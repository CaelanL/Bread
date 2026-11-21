-- Cached verse text now records which revision of the bible function's
-- parsing wrote it (`TEXT_REV` in supabase/functions/bible/cache.ts). The new
-- function reads only its own revision, so a row an old function writes in
-- the gap between this migration and the function deploy is a cache miss,
-- not served. Nullable and additive: the old function keeps working.
alter table verse_cache add column text_rev smallint;

-- The adapters now drop psalm titles, stanza names, speaker labels, notes and
-- omitted-verse neighbours, and keep word breaks at tags. Saved copies were
-- written by the old parsing; clear them so they refetch. Cache only, no
-- user data; KJV is never cached here.
-- destructive-ok: verse_cache licensed rows, approved by Caelan 2026-11-14
delete from verse_cache where version in ('ESV','NIV','NLT','NKJV');
