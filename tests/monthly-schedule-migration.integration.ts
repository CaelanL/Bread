import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

test('the actual monthly seed and artwork migrations preserve an existing selection and image on repeated application', () => {
  const apiUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  assert.ok(apiUrl && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname), 'Use a disposable local database.');
  const cwdUrl = readFileSync(join(process.cwd(), '.env.local'), 'utf8').match(/^EXPO_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/m)?.[1];
  assert.equal(apiUrl, cwdUrl, 'Run from the same disposable worktree as the selected environment; the CLI targets cwd.');
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const filename = readdirSync(directory).find((file) => file.endsWith('_monthly_verse_schedule.sql'));
  assert.ok(filename);
  const migration = readFileSync(new URL(filename, directory), 'utf8');
  const artworkFile = readdirSync(directory).find((file) => file.endsWith('_monthly_artwork.sql'));
  assert.ok(artworkFile);
  const artwork = readFileSync(new URL(artworkFile, directory), 'utf8');
  const fixture = mkdtempSync(join(tmpdir(), 'bread-monthly-migration-'));
  try {
    const file = join(fixture, 'monthly.sql');
    writeFileSync(file, `begin;
      create extension if not exists pgtap with schema extensions;
      select plan(4);
      update public.verse_of_month set book='John',chapter=3,verse_start=16,verse_end=16,
        image_url='https://example.test/original-month.jpg' where year_month='2026-11';
      update public.verse_of_month set image_url=null where year_month='2027-01';
      delete from public.verse_of_month where year_month='2036-10';
      ${migration}
      ${migration}
      ${artwork}
      ${artwork}
      select ok((select book='John' and chapter=3 and verse_start=16 and verse_end=16
        and image_url='https://example.test/original-month.jpg' from public.verse_of_month where year_month='2026-11'),
        'existing reference and artwork survive');
      select is((select count(*) from public.verse_of_month where year_month between '2026-11' and '2036-10'),120::bigint,'repeated seed fills gaps without duplicates');
      select ok((select book='Ephesians' and chapter=6 and verse_start=10 and verse_end=11
        from public.verse_of_month where year_month='2036-10'),'the final month is restored from the canonical cycle');
      select is((select string_agg(year_month || ' ' || substring(image_url from '[^/]+$'), ', ' order by year_month)
        from public.verse_of_month where year_month in ('2027-01','2036-10')),
        '2027-01 vtm-gold-trees.png, 2036-10 vtm-dark-sky.png','missing artwork is filled with the alternating public image');
      select * from finish(); rollback;`);
    const result = spawnSync('node_modules/.bin/supabase', ['test', 'db', '--local', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
