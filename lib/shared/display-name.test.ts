// lib-ok: Unit tests for the display name prefill.
import assert from 'node:assert/strict';
import test from 'node:test';

import { listNames, prefillDisplayName } from './display-name';

test('the prefill is the leading run of letters of the handle, capitalized', () => {
  assert.equal(prefillDisplayName('caelan.liu@example.com'), 'Caelan');
  assert.equal(prefillDisplayName('reader-a@example.test'), 'Reader');
  assert.equal(prefillDisplayName('JohnSmith@example.com'), 'JohnSmith');
});

test('a handle that starts with no letter uses all its letters, then Friend', () => {
  assert.equal(prefillDisplayName('42abc_d@example.com'), 'Abcd');
  assert.equal(prefillDisplayName('1234@example.com'), 'Friend');
  assert.equal(prefillDisplayName(null), 'Friend');
});

test('the prefill fits the 40-character limit', () => {
  assert.equal(prefillDisplayName(`${'a'.repeat(60)}@example.com`).length, 40);
});

test('names read as a sentence, with the rest counted past three', () => {
  assert.equal(listNames([]), '');
  assert.equal(listNames(['Eli']), 'Eli');
  assert.equal(listNames(['Eli', 'Faith']), 'Eli and Faith');
  assert.equal(listNames(['Eli', 'Faith', 'Gabe']), 'Eli, Faith and Gabe');
  assert.equal(listNames(['Eli', 'Faith', 'Gabe', 'Hana', 'Isaac']), 'Eli, Faith and 3 others');
});
