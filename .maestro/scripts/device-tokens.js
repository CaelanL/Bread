// Fails unless each seed reader's device_tokens rows on the local DB match EXPECT,
// e.g. "reader-a 1, reader-b 0". Signs in as each reader, so RLS shows only their own rows.
// API_URL and ANON_KEY come from `npm run sim -- flow`.
function count(reader) {
  const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: reader + '@example.test', password: 'password123' }),
  }).body);
  const rows = json(http.get(API_URL + '/rest/v1/device_tokens?select=expo_token', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token },
  }).body);
  return reader + ' ' + rows.length;
}

const got = ['reader-a', 'reader-b'].map(count).join(', ');
if (got !== EXPECT) throw new Error('device_tokens: ' + got + ', expected ' + EXPECT);
