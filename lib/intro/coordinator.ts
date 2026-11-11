// lib-ok: Coordinates one account-wide automatic intro against network and native-player boundaries.
import type { Session } from '@supabase/supabase-js';

import { claimIntroPresentation, hasIntroPresentation } from './api';
import type { IntroMedia } from './media';

interface IntroPlayer {
  prepare(source: string | number): Promise<void>;
  configureAudio(): Promise<void>;
  show(): void;
  close(): void;
}

export function createIntroCoordinator(accountId: string, getSession: () => Session | null, media: IntroMedia, player: IntroPlayer, eligible: () => boolean) {
  let generation = 0;
  let busy = false;
  let suppressed = false;
  const current = (request: number) => generation === request && eligible();

  async function play(automatic: boolean): Promise<boolean> {
    const session = getSession();
    if (!session || session.user.id !== accountId || !media.playback || !eligible() || (automatic && (suppressed || busy))) return false;
    const request = ++generation;
    busy = true;
    if (!automatic) suppressed = true;
    try {
      if (automatic && await hasIntroPresentation(session, media.id)) { suppressed = true; return false; }
      if (!current(request)) return false;
      await player.prepare(media.playback);
      if (!current(request)) return false;
      await player.configureAudio();
      if (!current(request)) return false;
      if (automatic) {
        // A lost acknowledgement must not grant another automatic attempt this session.
        suppressed = true;
        const claimed = await claimIntroPresentation(session, media.id);
        if (!claimed || !current(request)) { if (current(request)) player.close(); return false; }
      }
      if (!current(request)) return false;
      player.show();
      return true;
    } catch {
      if (generation === request) { suppressed = true; player.close(); }
      return false;
    } finally {
      if (generation === request) busy = false;
    }
  }

  return {
    attempt: () => play(true),
    replay: () => play(false),
    cancel() { generation++; busy = false; player.close(); },
  };
}
