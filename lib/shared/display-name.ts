// lib-ok: The name members see, built from first and last name, and names in a sentence.
export const MAX_NAME_PART_LENGTH = 30;

/** What members of a shared collection see: "Caelan L.", or "Caelan" with no last name. */
export function composeDisplayName(firstName: string, lastName: string | null): string {
  const first = firstName.trim();
  const initial = Array.from(lastName?.trim() ?? '')[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** Names in a sentence: "Eli", "Eli and Faith", "Eli, Faith and Gabe", then "Eli, Faith and 3 others". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
