// lib-ok: The store and Explore route share the deterministic import ID.
import type { BibleVersion } from '@/lib/settings';

export function curatedCollectionId(catalogId: string, version: BibleVersion): string {
  return `curated-${catalogId}-${version}`;
}
