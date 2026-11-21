// lib-ok: Unit tests for the name members see.
import assert from 'node:assert/strict';
import test from 'node:test';

import { composeDisplayName, firstName, initials, listNames } from './display-name';

test('members see the first name and the last initial', () => {
  assert.equal(composeDisplayName('Caelan', 'Liu'), 'Caelan L.');
  assert.equal(composeDisplayName(' Caelan ', ' liu '), 'Caelan L.');
  assert.equal(composeDisplayName('Ana', 'Ñúñez'), 'Ana Ñ.');
});

test('with no last name, members see the first name alone', () => {
  assert.equal(composeDisplayName('Caelan', null), 'Caelan');
  assert.equal(composeDisplayName('Caelan', '  '), 'Caelan');
});

test('names read as a sentence, with the rest counted past three', () => {
  assert.equal(listNames([]), '');
  assert.equal(listNames(['Eli']), 'Eli');
  assert.equal(listNames(['Eli', 'Faith']), 'Eli and Faith');
  assert.equal(listNames(['Eli', 'Faith', 'Gabe']), 'Eli, Faith and Gabe');
  assert.equal(listNames(['Eli', 'Faith', 'Gabe', 'Hana', 'Isaac']), 'Eli, Faith and 3 others');
});

test('emblems show the first initial, plus the last initial when there is one', () => {
  assert.equal(initials('Caelan L.'), 'CL');
  assert.equal(initials('Cara'), 'C');
  assert.equal(initials(' ana  ñ. '), 'AÑ');
  assert.equal(initials('  '), '?');
});

test('a Library card shows the first name alone', () => {
  assert.equal(firstName('Caelan L.'), 'Caelan');
  assert.equal(firstName(' Cara '), 'Cara');
});
