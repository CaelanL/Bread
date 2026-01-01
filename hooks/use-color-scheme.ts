import { useColorScheme as useSystemColorScheme } from 'react-native';
import { useAppStore } from '@/lib/store';

export function useColorScheme() {
  const systemScheme = useSystemColorScheme();
  const colorMode = useAppStore((state) => state.colorMode);

  if (colorMode === 'system') {
    return systemScheme;
  }
  return colorMode;
}
