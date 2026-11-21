// lib-ok: Monthly scheduling protects reference integrity and a continuous ten-year rotation.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

import { VERSE_COUNTS } from '../../supabase/functions/bible/verse-counts';
import { MONTHLY_PASSAGES, MONTHLY_SCHEDULE } from './schedule';

test('monthly schedule covers ten years with a distinct thirty-six-passage cycle', () => {
  assert.equal(MONTHLY_PASSAGES.length, 36);
  assert.equal(new Set(MONTHLY_PASSAGES.map((row) => JSON.stringify(row))).size, 36);
  assert.equal(MONTHLY_SCHEDULE.length, 120);
  assert.equal(MONTHLY_SCHEDULE[0].yearMonth, '2026-11');
  assert.equal(MONTHLY_SCHEDULE.at(-1)?.yearMonth, '2036-10');
  MONTHLY_SCHEDULE.forEach((row, index) => {
    const { yearMonth, ...reference } = row;
    assert.deepEqual(reference, MONTHLY_PASSAGES[index % 36]);
    const count = VERSE_COUNTS[row.book]?.[row.chapter - 1];
    assert.ok(count && row.verseStart > 0 && row.verseEnd <= count, yearMonth);
    assert.ok(row.verseEnd - row.verseStart <= 1, yearMonth);
    assert.deepEqual(Object.keys(row).sort(), ['book', 'chapter', 'verseEnd', 'verseStart', 'yearMonth']);
    if (index) {
      const previous = MONTHLY_SCHEDULE[index - 1].yearMonth.split('-').map(Number);
      const current = yearMonth.split('-').map(Number);
      assert.equal(current[0] * 12 + current[1], previous[0] * 12 + previous[1] + 1);
    }
    if (index >= 36) assert.deepEqual(reference, MONTHLY_PASSAGES[(index - 36) % 36]);
  });
});

test('the additive seed is generated from the canonical reference schedule', () => {
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const filename = readdirSync(directory).find((file) => file.endsWith('_monthly_verse_schedule.sql'));
  assert.ok(filename);
  const sql = readFileSync(new URL(filename, directory), 'utf8');
  const rows = [...sql.matchAll(/\('([\d-]+)', '([^']+)', (\d+), (\d+), (\d+)\)/g)].map((match) => ({
    yearMonth: match[1], book: match[2], chapter: Number(match[3]), verseStart: Number(match[4]), verseEnd: Number(match[5]),
  }));
  assert.deepEqual(rows, MONTHLY_SCHEDULE);
  assert.match(sql, /on conflict \(year_month\) do nothing/i);
});
