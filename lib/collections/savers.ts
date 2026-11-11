// lib-ok: Read aggregate curated-collection totals without exposing saver identities.
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/database.types';

import { CURATED_COLLECTIONS } from './catalog';

export async function readCollectionSavers(
  client: SupabaseClient<Database>,
  session: Session,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const request = client.rpc('get_curated_collection_saver_counts', {
    p_catalog_ids: CURATED_COLLECTIONS.map(({ id }) => id),
  }).setHeader('Authorization', `Bearer ${session.access_token}`);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error || !data) throw new Error('Could not load community saves.');
  return Object.fromEntries(data.map(({ catalog_id, saver_count }) => [catalog_id, saver_count]));
}

export function saverCountLabel(count: number): string {
  return count === 1 ? '1 person saved' : `${count.toLocaleString()} people saved`;
}
