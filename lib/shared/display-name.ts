// lib-ok: The display name prefill, shared by Settings and the share and join name sheet, and names in a sentence.
export const MAX_DISPLAY_NAME_LENGTH = 40;

/** The leading run of letters of the email handle, first letter capitalized: caelan.liu → Caelan. */
export function prefillDisplayName(email: string | null | undefined): string {
  const handle = (email ?? '').split('@')[0];
  const letters = handle.match(/^\p{L}+/u)?.[0] || handle.replace(/\P{L}/gu, '');
  if (!letters) return 'Friend';
  return (letters[0].toUpperCase() + letters.slice(1)).slice(0, MAX_DISPLAY_NAME_LENGTH);
}

/** Names in a sentence: "Eli", "Eli and Faith", "Eli, Faith and Gabe", then "Eli, Faith and 3 others". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
