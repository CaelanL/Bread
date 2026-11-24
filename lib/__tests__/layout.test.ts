// lib-ok: tests for lib/layout.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hiddenLineWidths, verseFontSize, windowClass } from '../layout';

describe('windowClass', () => {
  const cases: [string, number, number, ReturnType<typeof windowClass>][] = [
    ['iPhone SE', 375, 667, 'phone'],
    ['iPhone 16 Pro', 402, 874, 'phone'],
    ['iPhone 16 Pro Max', 440, 956, 'phone'],
    ['a phone on its side', 956, 440, 'phone'],
    ['Duo outer display', 466, 678, 'outer'],
    ['Duo inner, upright', 669, 951, 'tall'],
    ['Duo inner, landscape', 951, 669, 'wide'],
    ['iPad mini upright', 744, 1133, 'tall'],
    ['iPad mini landscape', 1133, 744, 'wide'],
    ['iPad 13" upright', 1032, 1376, 'wide'],
    ['iPad 13" landscape', 1376, 1032, 'wide'],
  ];
  for (const [name, width, height, expected] of cases) {
    it(`${name} (${width} × ${height}) is ${expected}`, () => {
      assert.equal(windowClass(width, height), expected);
    });
  }
});

describe('verseFontSize', () => {
  const text = (length: number) => 'x'.repeat(length);

  it('is 30 pt up to 90 characters', () => {
    assert.deepEqual(verseFontSize(text(90)), { fontSize: 30, lineHeight: 43 });
  });

  it('is 25 pt from 91 to 170 characters', () => {
    assert.deepEqual(verseFontSize(text(91)), { fontSize: 25, lineHeight: 36 });
    assert.deepEqual(verseFontSize(text(170)), { fontSize: 25, lineHeight: 36 });
  });

  it('is 21 pt past 170 characters', () => {
    assert.deepEqual(verseFontSize(text(171)), { fontSize: 21, lineHeight: 30 });
  });
});

describe('hiddenLineWidths', () => {
  it('draws one line, shorter than a full one, for a short verse', () => {
    const widths = hiddenLineWidths(10, 364, 30);
    assert.equal(widths.length, 1);
    assert.ok(widths[0] >= 38 && widths[0] < 100);
  });

  it('draws as many lines as the text would wrap to, the last one shorter', () => {
    // 364 pt at 21 pt fits about 34.7 characters a line, so 200 characters take 6 lines.
    const widths = hiddenLineWidths(200, 364, 21);
    assert.equal(widths.length, 6);
    const full = widths.slice(0, 5);
    for (const w of full) assert.ok(w > 90 && w <= 100);
    assert.ok(widths[5] >= 38 && widths[5] < Math.min(...full));
  });

  it('always draws at least one line', () => {
    assert.equal(hiddenLineWidths(0, 364, 30).length, 1);
  });
});
