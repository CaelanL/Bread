import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { URL } from 'node:url';

test('the real saver migration backfills only evidenced imports and is idempotent', () => {
  const apiUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  assert.ok(apiUrl && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiUrl).hostname), 'Use a disposable local database.');
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  const migration = readdirSync(migrations).sort().map((file) => readFileSync(new URL(file, migrations), 'utf8'))
    .findLast((sql) => sql.includes('create table public.curated_collection_savers'));
  assert.ok(migration);
  const backfill = migration.slice(migration.indexOf('-- The deterministic import identity'),
    migration.indexOf('create or replace function public.import_curated_collection'));
  assert.ok(backfill.includes('insert into public.curated_collection_savers'));
  const fixture = mkdtempSync(join(tmpdir(), 'bread-savers-migration-'));
  try {
    const file = join(fixture, 'migration.sql');
    writeFileSync(file, `begin;
      create extension if not exists pgtap with schema extensions;
      select plan(1);
      drop function public.get_curated_collection_saver_counts(text[]);
      drop function private.read_curated_collection_savers(text[]);
      drop function private.record_curated_collection_save(text,uuid);
      drop function private.curated_catalog_ids();
      drop table public.curated_collection_savers;
      select set_config('test.saver_a',gen_random_uuid()::text,true);
      select set_config('test.saver_b',gen_random_uuid()::text,true);
      insert into auth.users(id) values (current_setting('test.saver_a')::uuid),(current_setting('test.saver_b')::uuid);
      insert into public.user_collections(user_id,client_id,name,deleted_at) values
        (current_setting('test.saver_a')::uuid,'curated-hope-KJV','Renamed empty copy',now()),
        (current_setting('test.saver_a')::uuid,'curated-hope-ESV','Another translation',null),
        (current_setting('test.saver_b')::uuid,'curated-hope-NLT','Renamed copy',null),
        (current_setting('test.saver_b')::uuid,'ordinary','Hope',null),
        (current_setting('test.saver_b')::uuid,'curated-hope-invalid','Invalid version',null),
        (current_setting('test.saver_b')::uuid,'curated-future-catalog-KJV','Unknown catalog',null);
      ${migration}
      do $$ begin
        if (select count(*) from public.curated_collection_savers where catalog_id='hope'
          and user_id in(current_setting('test.saver_a')::uuid,current_setting('test.saver_b')::uuid)) <> 2 then
          raise exception 'Expected two unique savers across versions, edits and soft deletion';
        end if;
        if (select count(*) from public.curated_collection_savers where user_id in(
          current_setting('test.saver_a')::uuid,current_setting('test.saver_b')::uuid)) <> 2 then
          raise exception 'Ordinary, invalid or unknown identities must not be backfilled';
        end if;
      end $$;
      ${backfill}
      do $$ begin
        if (select count(*) from public.curated_collection_savers where user_id in(
          current_setting('test.saver_a')::uuid,current_setting('test.saver_b')::uuid)) <> 2 then
          raise exception 'Repeated backfill must not add contributions';
        end if;
      end $$;
      select pass('real migration backfill preserves unique evidenced contributions');
      select * from finish();
      rollback;`);
    const result = spawnSync('node_modules/.bin/supabase', ['test', 'db', '--local', file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
