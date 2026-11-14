// Local Supabase only: sign in as a seed user (supabase/seed.sql) and call a local function.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CURATED_COLLECTIONS } from '../../lib/collections/catalog';
import { MONTHLY_PASSAGES } from '../../lib/votm/schedule';

const env = Object.fromEntries(
  readFileSync(join(__dirname, '../../.env.local'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
);
export const API_URL: string = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY: string = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(API_URL).hostname)) {
  throw new Error('The grading audit only talks to the local database.');
}

// Seed users share the local seed password; each has its own daily Bible quota.
export const SEED_USERS = 'abcd'.split('').map((c) => `reader-${c}@example.test`);

export async function signIn(email: string): Promise<string> {
  const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`Sign-in failed for ${email}: ${res.status}`);
  return body.access_token;
}

export interface BibleResponse {
  text?: string;
  verses?: Record<string, string>;
  cached?: boolean;
  error?: string;
}

let bibleUser = 0;
let bibleToken: string | undefined;

// GET the local `bible` function, moving to the next seed user when one hits the daily quota.
// Status 429 means every seed user has (`npm run db:reset` clears the quota).
export async function getBible(query: string): Promise<{ status: number; body: BibleResponse }> {
  bibleToken ??= await signIn(SEED_USERS[bibleUser]);
  let res = await fetch(`${functionUrl('bible')}?${query}`, { headers: authHeaders(bibleToken) });
  while (res.status === 429 && bibleUser < SEED_USERS.length - 1) {
    bibleToken = await signIn(SEED_USERS[++bibleUser]);
    res = await fetch(`${functionUrl('bible')}?${query}`, { headers: authHeaders(bibleToken) });
  }
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export function functionUrl(name: string): string {
  return `${API_URL}/functions/v1/${name}`;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, apikey: ANON_KEY };
}

// The passages Bread suggests: curated collections and the monthly verses.
export function popularPassages(): string[] {
  const all = [...CURATED_COLLECTIONS.flatMap((c) => c.passages), ...MONTHLY_PASSAGES];
  const refs = all.map((p) => `${p.book} ${p.chapter}:${p.verseStart}${p.verseEnd !== p.verseStart ? `-${p.verseEnd}` : ''}`);
  return [...new Set(refs)];
}
