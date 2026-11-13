import { joinRouteFromLink } from '@/lib/shared/invite-code';

/** Incoming links before Expo Router reads them: a sendlabs.dev invite becomes /join/<code>. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return joinRouteFromLink(path);
}
