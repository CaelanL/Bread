import { useColorScheme as useSystemColorScheme } from 'react-native';
import { useAppStore } from '@/lib/store';

export function useColorScheme(): 'light' | 'dark' | null {
  const systemScheme = useSystemColorScheme();
  const colorMode = useAppStore((state) => state.colorMode);

  if (colorMode === 'system') {
    return systemScheme === 'light' || systemScheme === 'dark' ? systemScheme : null;
  }
  return colorMode;
}
