// lib-ok: Atomic curated collection import and its authoritative readback.
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import type { BibleVersion } from '@/lib/storage';
import type { Database } from '@/supabase/database.types';

import { CURATED_COLLECTIONS } from './catalog';

import { curatedCollectionId } from './identity';

export async function importCollection(
  client: SupabaseClient<Database>,
  session: Session,
  catalogId: string,
  version: BibleVersion,
  onSaved?: () => void,
) {
  const collection = CURATED_COLLECTIONS.find(({ id }) => id === catalogId);
  if (!collection) throw new Error('Collection not found.');

  const authorization = `Bearer ${session.access_token}`;
  const { data: id, error } = await client
    .rpc('import_curated_collection', {
      p_catalog_id: catalogId,
      p_name: collection.title,
      p_icon_key: collection.icon,
      p_version: version,
      p_passages: collection.passages.map(({ book, chapter, verseStart, verseEnd }) => ({
        book,
        chapter,
        verse_start: verseStart,
        verse_end: verseEnd,
      })),
    })
    .setHeader('Authorization', authorization);

  if (error || !id) throw new Error('Could not add this collection. Try again.');
  onSaved?.();

  const { data: row } = await client
    .from('user_collections')
    .select('*, verse_collections(added_at, user_verses!inner(*))')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .is('deleted_at', null)
    .is('verse_collections.user_verses.deleted_at', null)
    .setHeader('Authorization', authorization)
    .single();

  return { collectionId: curatedCollectionId(catalogId, version), row };
}
