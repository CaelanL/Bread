import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { CURATED_COLLECTIONS } from '../lib/collections/catalog.ts';

test('every shipped curated collection is recognized by the saver ledger', () => {
  const migration = readdirSync(new URL('../supabase/migrations/', import.meta.url)).sort().map((file) =>
    readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'),
  ).findLast((sql) => sql.includes('function private.curated_catalog_ids()'));
  assert.ok(migration, 'The saver catalog migration must exist.');
  const values = migration.match(/function private\.curated_catalog_ids\(\)[\s\S]*?select array\[([\s\S]*?)\]/)?.[1];
  assert.ok(values, 'Read the database-recognized catalog IDs.');
  const databaseIds = [...values.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(databaseIds, CURATED_COLLECTIONS.map(({ id }) => id).sort());
});
