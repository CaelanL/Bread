import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';

import { useAppStore } from '@/lib/store';

export function useCollectionSaversRefresh() {
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const refresh = () => { void useAppStore.getState().fetchCuratedSaverCounts(controller.signal); };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      controller.abort();
      subscription.remove();
    };
  }, []));
}
