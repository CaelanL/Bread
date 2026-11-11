// Verify the saved KJV collection after relaunch using the local seed account.
const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Expected a local API_URL');

const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'reader-b@example.test', password: 'password123' }),
}).body);
const rows = json(http.get(API_URL + '/rest/v1/user_collections?select=verse_collections(user_verses(version))&client_id=eq.curated-anxiety-and-peace-KJV&deleted_at=is.null', {
  headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token },
}).body);

if (rows.length !== 1) throw new Error('Expected exactly one imported KJV collection');
const memberships = rows[0].verse_collections;
if (memberships.length !== 12 || !memberships.every((row) => row.user_verses.version === 'KJV')) {
  throw new Error('Expected 12 KJV passages in the imported collection');
}
