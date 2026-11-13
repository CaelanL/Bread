// lib-ok: Unit tests for the invite code, link and error rules.
import assert from 'node:assert/strict';
import test from 'node:test';

import { daysLeft, inviteMessage, joinRouteFromLink, normalizeInviteCode, sharedErrorMessage } from './invite-code';

test('a typed code is normalized the way the server reads it', () => {
  assert.equal(normalizeInviteCode('bread-828'), 'BREAD828');
  assert.equal(normalizeInviteCode(' abcd 2345 xyz'), 'ABCD2345');
});

test('the share text carries the link and the code in plain words', () => {
  assert.equal(inviteMessage('Romans 8', 'ABCD2345'),
    'Join "Romans 8" with me on Bread: https://sendlabs.dev/bread/join/ABCD2345\n\n'
    + 'Or in Bread, tap + → Join with code: ABCD2345');
});

test('days left round up and never go negative', () => {
  const now = Date.parse('2026-11-11T12:00:00Z');
  assert.equal(daysLeft('2026-11-25T12:00:00Z', now), 14);
  assert.equal(daysLeft('2026-11-11T13:00:00Z', now), 1);
  assert.equal(daysLeft('2026-11-10T12:00:00Z', now), 0);
});

test('server messages show as is, invite errors read as advice, everything else as the fallback', () => {
  assert.equal(sharedErrorMessage({ code: '22023', message: 'This shared collection is full (30 members)' }, 'x'),
    'This shared collection is full (30 members)');
  assert.equal(sharedErrorMessage({ code: '22023', message: 'Invite expired' }, 'x'), 'This invite has expired. Ask for a new link.');
  assert.equal(sharedErrorMessage({ code: '42501', message: 'Not a member' }, 'Try again.'), 'Try again.');
  assert.equal(sharedErrorMessage(new Error('network'), 'Try again.'), 'Try again.');
});

test('a sendlabs.dev invite link opens Bread\'s join route; other links pass through', () => {
  assert.equal(joinRouteFromLink('https://sendlabs.dev/bread/join/ABCD2345'), '/join/ABCD2345');
  assert.equal(joinRouteFromLink('https://www.sendlabs.dev/bread/join/abcd-2345?ref=x'), '/join/ABCD2345');
  assert.equal(joinRouteFromLink('/bread/join/ABCD2345'), '/join/ABCD2345');
  assert.equal(joinRouteFromLink('com.biblemem://join/ABCD2345'), 'com.biblemem://join/ABCD2345');
  assert.equal(joinRouteFromLink('/(tabs)/(library)'), '/(tabs)/(library)');
  assert.equal(joinRouteFromLink('https://sendlabs.dev/work/linc'), 'https://sendlabs.dev/work/linc');
});
