// lib-ok: Intro media metadata and captions, with no unlicensed playable sermon asset.
export interface IntroMedia {
  id: string;
  headline: string;
  credit: string;
  sourceUrl: string;
  playback: string | number | null;
  captions: readonly { startMs: number; endMs: number; text: string }[];
  fixture?: boolean;
}

export const INTRO_VIDEO: IntroMedia = {
  id: 'scripture-encouragement',
  headline: 'What do you do?',
  credit: 'John Piper · Desiring God',
  sourceUrl: 'https://www.desiringgod.org/messages/if-my-words-abide-in-you--2/excerpts/your-deadliest-weapon-against-the-devil',
  playback: null,
  captions: [],
};

export function canUseIntroFixture(isDev: boolean, supabaseUrl: string | undefined): boolean {
  if (!isDev) return false;
  try {
    const url = new URL(supabaseUrl ?? '');
    return /^https?:$/.test(url.protocol) && /^(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/.test(url.hostname);
  } catch { return false; }
}

export function introMediaForPreview(isDev: boolean, url: string | undefined, mode: string | undefined, fixture: number): IntroMedia {
  if (!canUseIntroFixture(isDev, url) || !['sample', 'unavailable'].includes(mode ?? '')) return INTRO_VIDEO;
  return {
    ...INTRO_VIDEO,
    headline: 'Playback test',
    credit: 'Original Bread test video',
    playback: mode === 'sample' ? fixture : 'http://127.0.0.1:1/intro-missing.mp4',
    fixture: true,
    captions: [
      { startMs: 0, endMs: 3000, text: '[A soft tone plays]' },
      { startMs: 3000, endMs: 6000, text: '[The tone continues]' },
      { startMs: 6000, endMs: 9000, text: '[The tone fades]' },
    ],
  };
}

export function introCaption(media: IntroMedia, positionMs: number): string {
  return media.captions.find(({ startMs, endMs }) => positionMs >= startMs && positionMs < endMs)?.text ?? '';
}
