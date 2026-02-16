// ============================================================================
// Types
// ============================================================================

export type BibleVersion = 'ESV' | 'NLT' | 'NIV' | 'NKJV' | 'KJV';
export type ColorMode = 'light' | 'dark' | 'system';

// ============================================================================
// Translation Display Info
// ============================================================================

export const BIBLE_VERSIONS: { value: BibleVersion; label: string; full: string }[] = [
  { value: 'ESV', label: 'ESV', full: 'English Standard Version' },
  { value: 'NLT', label: 'NLT', full: 'New Living Translation' },
  { value: 'NIV', label: 'NIV', full: 'New International Version' },
  { value: 'NKJV', label: 'NKJV', full: 'New King James Version' },
  { value: 'KJV', label: 'KJV', full: 'King James Version' },
];

// ============================================================================
// Color Mode Display Info
// ============================================================================

export const COLOR_MODES: { value: ColorMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun.max.fill' },
  { value: 'dark', label: 'Dark', icon: 'moon.fill' },
  { value: 'system', label: 'System', icon: 'gear' },
];
