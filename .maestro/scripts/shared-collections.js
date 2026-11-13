// Shared collection checks over local REST, signed in as a seed user. Runs only against the seed database.
// MODE=invite: output.code is READER's newest live invite.
// MODE=handoff: records CODE as an install handoff for this Mac's network, as the sendlabs.dev join page does.
// MODE=no-copy: READER holds no row for Psalm 23:1-3 (left with an unmastered verse).
// MODE=personal-copy: READER's "Psalms" is a personal collection again, still holding Psalm 23:1-3.
// MODE=remove-members: READER, an owner, removes every plain member of their groups.
// MODE=mastered|engraved: READER's verses matching FILTER (PostgREST query) get the seed's progress for that state.
const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('shared-collections requires local Supabase');

const session = json(http.post(API_URL + '/auth/v1/token?grant_type=password', {
  headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: READER + '@example.test', password: 'password123' }),
}).body);
if (!session.access_token) throw new Error('Local seed sign-in failed');
const headers = { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token };
const get = (path) => json(http.get(API_URL + '/rest/v1/' + path, { headers: headers }).body);

if (MODE === 'handoff') {
  const response = http.post(API_URL + '/functions/v1/invite-handoff', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'record', code: CODE }),
  });
  if (response.status !== 200) throw new Error('Handoff record failed: ' + response.status);
} else if (MODE === 'invite') {
  const rows = get('shared_invites?select=code&revoked_at=is.null&order=created_at.desc&limit=1');
  if (rows.length !== 1) throw new Error('No live invite for ' + READER);
  output.code = rows[0].code;
} else if (MODE === 'no-copy') {
  const rows = get('user_verses?select=id&book=eq.Psalms&chapter=eq.23&verse_start=eq.1&verse_end=eq.3');
  if (rows.length !== 0) throw new Error(READER + ' still holds Psalm 23:1-3 after leaving');
} else if (MODE === 'personal-copy') {
  const rows = get('user_collections?select=shared_collection_id,verse_collections(user_verses(book,chapter,verse_start,verse_end))&name=eq.Psalms&deleted_at=is.null');
  if (rows.length !== 1) throw new Error('Expected one Psalms collection, got ' + rows.length);
  if (rows[0].shared_collection_id !== null) throw new Error('Psalms is still shared');
  const verses = rows[0].verse_collections.map((link) => link.user_verses);
  if (verses.length !== 1 || verses[0].chapter !== 23 || verses[0].verse_end !== 3) throw new Error('Psalm 23:1-3 is missing from the copy');
} else if (MODE === 'mastered' || MODE === 'engraved') {
  const passes = MODE === 'engraved' ? 10 : 2;
  const progress = {
    easy: { bestAccuracy: 100, completed: true },
    medium: { bestAccuracy: 98, completed: true },
    hard: { bestAccuracy: 96, completed: true },
    engraved: { completed: MODE === 'engraved', passCount: passes, lifetimeReviews: passes, nextDueAt: null, lastReviewedAt: null, months: [] },
  };
  const response = http.request(API_URL + '/rest/v1/user_verses?' + FILTER, {
    method: 'PATCH',
    headers: Object.assign({ 'Content-Type': 'application/json', Prefer: 'return=representation' }, headers),
    body: JSON.stringify({ progress: progress }),
  });
  const rows = json(response.body);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('No ' + READER + ' verses matched ' + FILTER + ': ' + response.body);
} else if (MODE === 'remove-members') {
  const members = get('shared_collection_members?select=shared_collection_id,user_id&role=eq.member');
  if (members.length === 0) throw new Error('No members to remove for ' + READER);
  members.forEach((m) => {
    const response = http.post(API_URL + '/rest/v1/rpc/remove_shared_member', {
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify({ p_shared: m.shared_collection_id, p_user: m.user_id }),
    });
    if (response.status >= 300) throw new Error('Remove failed: ' + response.body);
  });
} else {
  throw new Error('Unknown MODE ' + MODE);
}
