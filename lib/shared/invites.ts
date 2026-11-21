// lib-ok: Shared-collection reads that keep no store state (invite preview, live invite, members) and copying an invite.
import { supabase } from '@/lib/api/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SharedRole } from '@/lib/storage';
import type { Database } from '@/supabase/database.types';
import { TurboModuleRegistry, type TurboModule } from 'react-native';

import { isSharedRole, normalizeInviteCode } from './invite-code';

const db: SupabaseClient<Database> = supabase;

export interface InvitePreview {
  sharedId: string;
  name: string;
  inviterName: string;
  verseCount: number;
  memberCount: number;
  alreadyMember: boolean;
}

export interface LiveInvite {
  code: string;
  expiresAt: string;
}

export interface SharedMember {
  userId: string;
  displayName: string;
  role: SharedRole;
}

/** What a signed-in person sees before joining. Throws the server's 22023 for expired or unknown codes. */
export async function previewInvite(code: string): Promise<InvitePreview> {
  const { data, error } = await db.rpc('preview_invite', { p_code: normalizeInviteCode(code) });
  if (error) throw error;
  const row = data[0];
  if (!row) throw Object.assign(new Error('Invite not found'), { code: '22023' });
  return {
    sharedId: row.shared_id,
    name: row.name,
    inviterName: row.inviter_name ?? 'Someone',
    verseCount: row.verse_count,
    memberCount: row.member_count,
    alreadyMember: row.already_member,
  };
}

/** The owner's open invite, or null once it has expired or been replaced. */
export async function getLiveInvite(sharedId: string): Promise<LiveInvite | null> {
  const { data, error } = await supabase
    .from('shared_invites')
    .select('code, expires_at')
    .eq('shared_collection_id', sharedId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] ? { code: data[0].code, expiresAt: data[0].expires_at } : null;
}

/** Owner first, then by join time. */
export async function getSharedMembers(sharedId: string): Promise<SharedMember[]> {
  const { data, error } = await db.rpc('get_shared_members', { p_shared: sharedId });
  if (error) throw error;
  return data.map((row) => ({
    userId: row.user_id,
    displayName: row.display_name ?? 'Member',
    role: isSharedRole(row.role) ? row.role : 'member',
  }));
}

// React Native's own clipboard module, reached directly: the `Clipboard` export warns that it is
// deprecated, and expo-clipboard would need a new native build.
interface ClipboardModule extends TurboModule {
  setString(content: string): void;
}

export function copyText(text: string) {
  const clipboard = TurboModuleRegistry.get<ClipboardModule>('Clipboard');
  if (!clipboard) throw new Error('Copying is not available here.');
  clipboard.setString(text);
}
