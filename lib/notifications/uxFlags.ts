/**
 * UX-flag store for the Q1 explainer card + Q14 settings-tab badge.
 *
 * Backed by a Zustand store so subscribers (the badge hook, the
 * explainer card) re-render the moment a flag flips — no waiting for
 * the next AppState 'active' event. AsyncStorage is the cross-launch
 * cache; Zustand is the in-session truth.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const Q1_DISMISSED_KEY = 'notifications_q1_dismissed';
const SETTINGS_VISITED_KEY = 'notifications_settings_visited';

interface UxFlagsState {
  q1Dismissed: boolean;
  settingsVisited: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  markQ1Dismissed: () => Promise<void>;
  markSettingsVisited: () => Promise<void>;
  resetForDev: () => Promise<void>;
}

export const useUxFlagsStore = create<UxFlagsState>((set) => ({
  q1Dismissed: false,
  settingsVisited: false,
  hydrated: false,

  hydrate: async () => {
    try {
      const [q1, visited] = await Promise.all([
        AsyncStorage.getItem(Q1_DISMISSED_KEY),
        AsyncStorage.getItem(SETTINGS_VISITED_KEY),
      ]);
      set({
        q1Dismissed: q1 === '1',
        settingsVisited: visited === '1',
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  markQ1Dismissed: async () => {
    set({ q1Dismissed: true });
    await AsyncStorage.setItem(Q1_DISMISSED_KEY, '1');
  },

  markSettingsVisited: async () => {
    set({ settingsVisited: true });
    await AsyncStorage.setItem(SETTINGS_VISITED_KEY, '1');
  },

  resetForDev: async () => {
    set({ q1Dismissed: false, settingsVisited: false });
    await AsyncStorage.removeItem(Q1_DISMISSED_KEY);
    await AsyncStorage.removeItem(SETTINGS_VISITED_KEY);
  },
}));
