// lib-ok: Imported collection IDs retain their selected translation after rename or edits.
import type { BibleVersion } from '@/lib/settings';

export function curatedCollectionId(catalogId: string, version: BibleVersion): string {
  return `curated-${catalogId}-${version}`;
}

export function curatedCollectionVersion(id: string): string | undefined {
  return /^curated-[a-z]+(?:-[a-z]+)*-([A-Z0-9][A-Z0-9-]{1,15})$/.exec(id)?.[1];
}
