// The 2.0 "What's new in Bread" walkthrough's flag on READER's profile. Runs only against the seed database.
// MODE=unseen: READER is an account from before 2.0 that hasn't seen it.
// MODE=seen: READER has seen it (or is new since 2.0, which starts as seen).
// MODE=check-seen: fails unless READER's walkthrough is marked seen.
const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
const isLocal = host === '127.0.0.1' || host === 'localhost' || /^(10|192\.168)\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
if (!isLocal) throw new Error('welcome requires local Supabase');

const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: READER + '@example.test', password: 'password123' }),
}).body);
if (!session.access_token) throw new Error('Local seed sign-in failed');
const headers = { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

if (MODE === 'unseen' || MODE === 'seen') {
  const response = http.post(API_URL + '/rest/v1/profiles', {
    headers: headers,
    body: JSON.stringify({ user_id: session.user.id, welcome_v2_seen_at: MODE === 'seen' ? new Date().toISOString() : null }),
  });
  if (response.status >= 300) throw new Error('Setting the welcome flag failed: ' + response.status);
} else if (MODE === 'check-seen') {
  const rows = json(http.get(API_URL + '/rest/v1/profiles?select=welcome_v2_seen_at', { headers: headers }).body);
  if (rows.length !== 1 || rows[0].welcome_v2_seen_at === null) throw new Error(READER + "'s walkthrough isn't marked seen");
} else {
  throw new Error('Unknown MODE ' + MODE);
}
