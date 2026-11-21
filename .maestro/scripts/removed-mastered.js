// reader-a's mastered John 3:16, removed from its only collection or put back. Runs only against the seed database.
// MODE=remove: removes it from My Verses through delete_verse, so it stays only on the Mastered list.
// MODE=restore: puts it back in My Verses, as the seed has it.
const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
const isLocal = host === '127.0.0.1' || host === 'localhost' || /^(10|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
if (!isLocal) throw new Error('removed-mastered requires local Supabase');

const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'reader-a@example.test', password: 'password123' }),
}).body);
if (!session.access_token) throw new Error('Local seed sign-in failed');
const headers = { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
const get = (path) => json(http.get(API_URL + '/rest/v1/' + path, { headers: headers }).body);
const verse = get('user_verses?select=id,deleted_at,verse_collections(collection_id)&client_id=eq.seed-john-3-16')[0];
if (!verse) throw new Error('reader-a has no John 3:16');

if (MODE === 'remove') {
  const response = http.post(API_URL + '/rest/v1/rpc/delete_verse', {
    headers: headers,
    body: JSON.stringify({ verse_client_id: 'seed-john-3-16', collection_client_id: 'my-verses' }),
  });
  if (response.status >= 300) throw new Error('delete_verse failed: ' + response.status);
  const after = get('user_verses?select=deleted_at,verse_collections(collection_id)&client_id=eq.seed-john-3-16')[0];
  if (!after || !after.deleted_at || after.verse_collections.length !== 0) throw new Error('John 3:16 is not removed-but-mastered');
} else if (MODE === 'restore') {
  const myVerses = get('user_collections?select=id&client_id=eq.my-verses')[0];
  const patch = http.request(API_URL + '/rest/v1/user_verses?id=eq.' + verse.id, {
    method: 'PATCH', headers: headers, body: JSON.stringify({ deleted_at: null }),
  });
  if (patch.status >= 300) throw new Error('Restore failed: ' + patch.status);
  if (!verse.verse_collections.some((link) => link.collection_id === myVerses.id)) {
    const link = http.post(API_URL + '/rest/v1/verse_collections', {
      headers: headers, body: JSON.stringify({ verse_id: verse.id, collection_id: myVerses.id }),
    });
    if (link.status >= 300) throw new Error('Relink failed: ' + link.status);
  }
} else {
  throw new Error('Unknown MODE ' + MODE);
}
