// Read back the actual membership after copy or removal. Runs only against the seed database.
const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('library-membership requires local Supabase');

const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'reader-a@example.test', password: 'password123' }),
}).body);
const rows = json(http.get(
  API_URL + '/rest/v1/verse_collections?select=verse_id,user_verses!inner(client_id,version,progress),user_collections!inner(name)&user_verses.client_id=eq.seed-john-3-16',
  { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token } }
).body);
const names = rows.map((row) => row.user_collections.name).sort().join(', ');
const expected = EXPECT_COPY === 'yes' ? 'My Verses, Verses for patience and encouragement' : 'My Verses';
if (names !== expected) throw new Error('Unexpected verse memberships: ' + names);
if (!rows.every((row) => row.verse_id === rows[0].verse_id
  && row.user_verses.version === 'ESV'
  && row.user_verses.progress.hard.bestAccuracy === 92
  && row.user_verses.progress.engraved.passCount === 1)) {
  throw new Error('Copy changed verse identity, translation or progress');
}
