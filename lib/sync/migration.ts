import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/api/client';
import { ensureAuth } from '@/lib/api';
import { getCollections, getSavedVerses } from '@/lib/storage';
import { syncEnsureDefaultCollection, getServerCollectionId } from './collections';

const MIGRATION_KEY = 'data_synced_to_server';

async function getCurrentUserId(): Promise<string> {
  await ensureAuth();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

/**
 * Check if local data has been migrated to server
 */
export async function isMigrationComplete(): Promise<boolean> {
  const value = await AsyncStorage.getItem(MIGRATION_KEY);
  return value === 'true';
}

/**
 * Mark migration as complete
 */
async function markMigrationComplete(): Promise<void> {
  await AsyncStorage.setItem(MIGRATION_KEY, 'true');
}

/**
 * Migrate all local data to server
 * Called once when user first signs in or on app upgrade
 */
export async function migrateLocalDataToServer(): Promise<void> {
  const isComplete = await isMigrationComplete();
  if (isComplete) {
    return;
  }

  try {
    // 0. Get current user ID
    const userId = await getCurrentUserId();

    // 1. Get all local collections
    const collections = await getCollections();

    // 2. Create a map of client_id -> server_id for collections
    const collectionIdMap = new Map<string, string>();

    // 3. Sync collections to server
    for (const collection of collections) {
      // Check if collection already exists on server
      const existingId = await getServerCollectionId(collection.id);

      if (existingId) {
        collectionIdMap.set(collection.id, existingId);
        continue;
      }

      // Create collection on server
      const { data, error } = await supabase
        .from('user_collections')
        .insert({
          user_id: userId,
          client_id: collection.id,
          name: collection.name,
          is_default: collection.isDefault,
          created_at: new Date(collection.createdAt).toISOString(),
        })
        .select('id')
        .single();

      if (error) {
        console.error(`[MIGRATION] Failed to sync collection ${collection.id}:`, error);
        // If it's a duplicate error, try to get the existing ID
        if (error.code === '23505') {
          const existing = await getServerCollectionId(collection.id);
          if (existing) {
            collectionIdMap.set(collection.id, existing);
          }
        }
        continue;
      }

      collectionIdMap.set(collection.id, data.id);
    }

    // 4. Ensure default collection exists
    const defaultServerId = await syncEnsureDefaultCollection();
    collectionIdMap.set('my-verses', defaultServerId);

    // 5. Get all local verses
    const verses = await getSavedVerses();

    // 6. Sync verses to server
    let syncedVerses = 0;
    for (const verse of verses) {
      // Get server collection ID
      const serverCollectionId = collectionIdMap.get(verse.collectionId) || defaultServerId;

      // Check if verse already exists on server
      const { data: existing } = await supabase
        .from('user_verses')
        .select('id')
        .eq('client_id', verse.id)
        .single();

      if (existing) {
        // Update progress if verse exists
        await supabase
          .from('user_verses')
          .update({ progress: verse.progress })
          .eq('client_id', verse.id);
        syncedVerses++;
        continue;
      }

      // Create verse on server
      const { error } = await supabase.from('user_verses').insert({
        user_id: userId,
        client_id: verse.id,
        collection_id: serverCollectionId,
        book: verse.book,
        chapter: verse.chapter,
        verse_start: verse.verseStart,
        verse_end: verse.verseEnd,
        text: verse.text,
        version: verse.version,
        progress: verse.progress,
        created_at: new Date(verse.createdAt).toISOString(),
      });

      if (error) {
        console.error(`[MIGRATION] Failed to sync verse ${verse.id}:`, error);
        continue;
      }

      syncedVerses++;
    }

    // 7. Mark migration complete
    await markMigrationComplete();
  } catch (e) {
    console.error('[MIGRATION] Migration failed:', e);
    throw e;
  }
}

/**
 * Reset migration flag (for testing)
 */
export async function resetMigration(): Promise<void> {
  await AsyncStorage.removeItem(MIGRATION_KEY);
}
