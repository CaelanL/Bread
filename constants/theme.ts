/**
 * Centralized color system for the app.
 * All colors should be defined here to enable easy theming.
 */

import { Platform } from 'react-native';

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
    primaryLight: 'rgba(176,141,87,0.12)',

    // Surfaces
    card: '#ffffff',              // Pure white cards for contrast
    cardAlt: '#f5f3f0',           // Warm light gray
    input: '#f5f3f0',             // Warm input background
    overlay: 'rgba(0,0,0,0.5)',

    // Borders
    border: '#e0dcd6',            // Warm gray border
    borderLight: '#ebe7e1',       // Lighter warm border

    // Status (keep functional)
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',

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
    primaryLight: 'rgba(201,169,98,0.15)',

    // Surfaces
    card: '#242424',              // Dark charcoal card
    cardAlt: '#2e2e2e',           // Slightly lighter
    input: '#2e2e2e',             // Input background
    overlay: 'rgba(0,0,0,0.6)',

    // Borders
    border: '#3a3a3a',            // Charcoal border
    borderLight: '#444444',       // Lighter charcoal

    // Status (same both modes)
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',

    // Utility
    shadow: '#000',
    white: '#ffffff',
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
