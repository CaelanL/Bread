import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { AppState } from 'react-native';

import { resumeTracker } from '@/lib/resume';
import { useAppStore } from '@/lib/store';

export function useCollectionSaversRefresh() {
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const refresh = () => { void useAppStore.getState().fetchCuratedSaverCounts(controller.signal); };
    refresh();
    const subscription = AppState.addEventListener('change', resumeTracker(refresh));
    return () => {
      controller.abort();
      subscription.remove();
    };
  }, []));
}
