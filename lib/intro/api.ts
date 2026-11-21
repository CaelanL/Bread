// lib-ok: Account-pinned intro state reads and atomic presentation claims.
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/api/client';

export async function hasIntroPresentation(session: Session, introId: string): Promise<boolean> {
  const { data, error } = await supabase.from('user_intro_presentations')
    .select('intro_id').eq('user_id', session.user.id).eq('intro_id', introId)
    .setHeader('Authorization', `Bearer ${session.access_token}`).maybeSingle();
  if (error) throw new Error('Intro state is unavailable.');
  return !!data;
}

export async function claimIntroPresentation(session: Session, introId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_intro_presentation', { p_intro_id: introId })
    .setHeader('Authorization', `Bearer ${session.access_token}`);
  if (error || typeof data !== 'boolean') throw new Error('Intro claim is unavailable.');
  return data;
}
