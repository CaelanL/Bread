// Changes Cara's "Psalm 23" on the server behind the app's saved library, then puts it back.
// MODE=empty unlinks its verses (they stay mastered, on the Mastered list); MODE=restore links them
// again, as the seed has them. Runs only against the seed database.
const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('delete-before-sync requires local Supabase');

const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'reader-c@example.test', password: 'password123' }),
}).body);
const headers = { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
const collection = json(http.get(API_URL + '/rest/v1/user_collections?select=id&client_id=eq.seed-psalm-23', { headers }).body)[0];
if (!collection) throw new Error('Psalm 23 is missing: run npm run db:reset');

if (MODE === 'empty') {
  const removed = http.request(API_URL + '/rest/v1/verse_collections?collection_id=eq.' + collection.id, { method: 'DELETE', headers });
  if (removed.status >= 300) throw new Error('Could not unlink Psalm 23: ' + removed.body);
} else {
  const verses = json(http.get(API_URL + '/rest/v1/user_verses?select=id&book=eq.Psalms&chapter=eq.23&or=(verse_start.eq.1,verse_start.eq.4)', { headers }).body);
  if (verses.length !== 2) throw new Error('Expected Psalm 23:1 and 23:4, found ' + verses.length);
  const linked = http.post(API_URL + '/rest/v1/verse_collections', {
    headers,
    body: JSON.stringify(verses.map((v) => ({ verse_id: v.id, collection_id: collection.id }))),
  });
  if (linked.status >= 300) throw new Error('Could not link Psalm 23 again: ' + linked.body);
}
