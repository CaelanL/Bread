const host = (API_URL.match(/^https?:\/\/([^:/]+)/) || [])[1];
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error('Expected a local API_URL');
const catalogId = 'anxiety-and-peace';
function signIn(reader) {
  const response = http.post(API_URL + '/auth/v1/token?grant_type=password', {
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: reader + '@example.test', password: 'password123' }),
  });
  const session = json(response.body);
  if (!session.access_token) throw new Error('Local seed sign-in failed');
  return { apikey: ANON_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
}
function total(headers) {
  const rows = json(http.post(API_URL + '/rest/v1/rpc/get_curated_collection_saver_counts', {
    headers: headers, body: JSON.stringify({ p_catalog_ids: [catalogId] }),
  }).body);
  if (rows.length !== 1 || typeof rows[0].saver_count !== 'number') throw new Error('Expected one real aggregate total');
  return rows[0].saver_count;
}
function hadSaved(headers) {
  const rows = json(http.get(API_URL + '/rest/v1/user_collections?select=client_id&client_id=like.curated-anxiety-and-peace-*', {
    headers: headers,
  }).body);
  if (!Array.isArray(rows)) throw new Error('Could not read own import evidence');
  return rows.some(function(row) { return /^curated-anxiety-and-peace-[A-Z0-9][A-Z0-9-]{1,15}$/.test(row.client_id); });
}
// Mirrors saverCountLabel: no line below 10.
function label(count) { return count < 10 ? '' : count + ' saves'; }
const a = signIn('reader-a');
if (MODE === 'baseline') {
  const b = signIn('reader-b');
  const before = total(a);
  const afterA = before + (hadSaved(a) ? 0 : 1);
  const afterB = afterA + (hadSaved(b) ? 0 : 1);
  output.savers = { before: before, afterA: afterA, afterB: afterB,
    beforeLabel: label(before), afterALabel: label(afterA), afterBLabel: label(afterB) };
} else if (MODE === 'another-version') {
  // A short RPC fixture checks translation deduplication without a Bible-provider dependency.
  const saved = http.post(API_URL + '/rest/v1/rpc/import_curated_collection', {
    headers: a,
    body: JSON.stringify({ p_catalog_id: catalogId, p_name: 'Anxiety & Peace', p_icon_key: 'dove', p_version: 'NKJV',
      p_passages: [{ book: 'Psalms', chapter: 56, verse_start: 3, verse_end: 3 }] }),
  });
  if (typeof json(saved.body) !== 'string') throw new Error('Another-version import failed');
  if (total(a) !== output.savers.afterA) throw new Error('Another translation changed the unique saver total');
} else {
  const expected = MODE === 'check-b' ? output.savers.afterB : output.savers.afterA;
  if (total(a) !== expected) throw new Error('Expected all-time unique saver total ' + expected);
}
