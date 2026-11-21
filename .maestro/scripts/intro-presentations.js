const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Expected the local verifier.');
function count(reader) {
  const auth = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: reader + '@example.test', password: 'password123' }),
  }).body);
  if (!auth.access_token) throw new Error('Local seed sign-in failed.');
  const rows = json(http.get(API_URL + '/rest/v1/user_intro_presentations?select=intro_id&intro_id=eq.scripture-encouragement', {
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + auth.access_token },
  }).body);
  if (!Array.isArray(rows)) throw new Error('Could not read the local intro marker.');
  return rows.length;
}
const actual = count(READER);
if (actual !== Number(EXPECTED)) throw new Error('Expected ' + EXPECTED + ' account intro marker, got ' + actual);
