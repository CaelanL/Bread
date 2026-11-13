// lib-ok: Keeps the shared-reference book check in SQL in step with the bundled book list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BIBLE_BOOKS } from '../bible/books';

test('shared_collection_verses accepts exactly the canonical book names', () => {
  const sql = readFileSync('supabase/migrations/20261112003908_shared_collections.sql', 'utf8');
  const list = sql.match(/constraint shared_collection_verses_book_check check \(book in \(([\s\S]*?)\)\)/)?.[1];
  assert.ok(list, 'book check not found');
  const books = [...list.matchAll(/'((?:[^']|'')+)'/g)].map((m) => m[1].replace(/''/g, "'"));
  assert.deepEqual(books, [...BIBLE_BOOKS]);
});
