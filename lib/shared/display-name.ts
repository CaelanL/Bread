// lib-ok: The display name prefill, shared by Settings and the share and join name sheet.
export const MAX_DISPLAY_NAME_LENGTH = 40;

/** The leading run of letters of the email handle, first letter capitalized: caelan.liu → Caelan. */
export function prefillDisplayName(email: string | null | undefined): string {
  const handle = (email ?? '').split('@')[0];
  const letters = handle.match(/^\p{L}+/u)?.[0] || handle.replace(/\P{L}/gu, '');
  if (!letters) return 'Friend';
  return (letters[0].toUpperCase() + letters.slice(1)).slice(0, MAX_DISPLAY_NAME_LENGTH);
}
