/**
 * Centralized color system for the app.
 * All colors should be defined here to enable easy theming.
 */

import { Platform } from 'react-native';

// Auth/login screen colors
export const authAccent = '#dbe2d1';  // bird color - for text, borders
export const authButton = '#3a3a3a';  // dark grey - for buttons

// Standard UI values. eslint.config.mjs rejects other radii, durations and press scales.
export const Radius = { xs: 4, sm: 8, md: 10, lg: 12, xl: 14, xxl: 16, xxxl: 20, huge: 24, full: 999 } as const;
export const Motion = {
  pressScale: 0.96,
  pressMs: 150,
  exitMs: 150,
  expandMs: 200,
  staggerMs: 100,
  spinnerMs: 900,
  easing: [0.2, 0, 0, 1],
} as const;
/**
 * Spread first into every TextInput style. iOS on the New Architecture recycles TextInput views,
 * and a recycled view keeps the last input's letter spacing and weight when the next one sets
 * none (react-native#42589), so each input states both.
 */
export const InputText = { letterSpacing: 0, fontWeight: '400' } as const;
export const Shadows = {
  floating: '0px 4px 10px rgba(0,0,0,0.14)',
  border: '0px 0px 0px 1px rgba(0,0,0,0.06), 0px 1px 2px -1px rgba(0,0,0,0.06), 0px 2px 4px 0px rgba(0,0,0,0.04)',
  borderHover: '0px 0px 0px 1px rgba(0,0,0,0.08), 0px 1px 2px -1px rgba(0,0,0,0.08), 0px 2px 4px 0px rgba(0,0,0,0.06)',
} as const;

/** How much of a collection's accent shows behind its icon and across the top of its screen. */
export const AccentAlpha = { fill: 0.14, wash: 0.18 } as const;

/** `#rrggbb` at `alpha`, for an accent that isn't a token itself (a collection's icon colour). */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export const Colors = {
  light: {
    // Core
    text: '#1a1a1a',              // Near-black for readability
    background: '#faf8f5',        // Warm off-white/ivory
    tint: '#b08d57',              // Bronze gold accent
    icon: '#6b6b6b',              // Warm gray
    tabIconDefault: '#8a8a8a',    // Medium gray
    tabIconSelected: '#b08d57',   // Bronze gold

    // Primary (bronze gold)
    primary: '#b08d57',           // Muted bronze/champagne gold
    recordingControl: '#987142',
    recordingAction: 'rgba(0,0,0,0.10)',
    primaryLight: 'rgba(176,141,87,0.12)',
    engravedFill: 'rgba(245,158,11,0.12)', // Engraved pill and engraved collection icon
    engravedCard: '#fef8ee',       // Library card of an engraved collection: card + a gold wash, opaque over the swipe action

    // Surfaces
    card: '#ffffff',              // Pure white cards for contrast
    cardAlt: '#f5f3f0',           // Warm light gray
    fill: 'rgba(0,0,0,0.05)',     // Quiet fill on the page: pills, pressed rows
    input: '#f5f3f0',             // Warm input background
    overlay: 'rgba(0,0,0,0.5)',

    // Borders
    border: '#e0dcd6',            // Warm gray border
    borderLight: '#ebe7e1',       // Lighter warm border

    // Status (keep functional)
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    destructiveAction: '#c93636',

    // Utility
    shadow: '#000',
    white: '#ffffff',
  },
  dark: {
    // Core
    text: '#f5f5f5',              // Off-white text
    background: '#1a1a1a',        // Soft charcoal (not pure black)
    tint: '#c9a962',              // Lighter bronze for dark mode
    icon: '#9a9a9a',              // Silver gray
    tabIconDefault: '#6b6b6b',    // Muted gray
    tabIconSelected: '#c9a962',   // Bronze gold

    // Primary (bronze gold - slightly lighter for dark)
    primary: '#c9a962',           // Brighter bronze for dark mode
    recordingControl: '#a8824c',
    recordingAction: 'rgba(0,0,0,0.10)',
    primaryLight: 'rgba(201,169,98,0.15)',
    engravedFill: 'rgba(245,158,11,0.15)',
    engravedCard: '#393022',

    // Surfaces
    card: '#242424',              // Dark charcoal card
    cardAlt: '#2e2e2e',           // Slightly lighter
    fill: 'rgba(255,255,255,0.08)',
    input: '#2e2e2e',             // Input background
    overlay: 'rgba(0,0,0,0.6)',

    // Borders
    border: '#3a3a3a',            // Charcoal border
    borderLight: '#444444',       // Lighter charcoal

    // Status (same both modes)
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    destructiveAction: '#c93636',

    // Utility
    shadow: '#000',
    white: '#ffffff',
  },
};

export const MonthlyCardColors = {
  overlay: 'rgba(0,0,0,0.16)',
  subtext: 'rgba(255,255,255,0.7)',
  badge: 'rgba(255,255,255,0.2)',
  masteredImage: 'rgba(34,197,94,0.3)',
  masteredPlain: 'rgba(34,197,94,0.15)',
} as const;

// Decorative collection artwork. Copy always uses the core text and surface tokens.
export const CollectionArtColors = {
  light: {
    blue: { surface: '#dce8eb', wash: '#c7dbe1', ink: '#345762' },
    gold: { surface: '#f1e6cb', wash: '#e8d4a9', ink: '#745526' },
    rose: { surface: '#f0dfda', wash: '#e6cbc5', ink: '#814d46' },
    green: { surface: '#e0e9d7', wash: '#ccdcc1', ink: '#446044' },
    violet: { surface: '#e8e0ee', wash: '#dcd0e6', ink: '#644976' },
  },
  dark: {
    blue: { surface: '#293b43', wash: '#354e5a', ink: '#bbd9e2' },
    gold: { surface: '#403526', wash: '#53452e', ink: '#e7ce96' },
    rose: { surface: '#442f31', wash: '#573b3e', ink: '#eac0b8' },
    green: { surface: '#303b2d', wash: '#3d4c36', ink: '#cadfb9' },
    violet: { surface: '#3c3144', wash: '#4c3b59', ink: '#e1c9ed' },
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
