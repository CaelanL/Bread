import { router } from 'expo-router';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { useTopBarHeight } from '@/components/ui/TopBar';
import { useWindowClass } from '@/hooks/use-window-class';

const CONTENT_PAD = 20;

/** Settings → Notifications on a phone. On a wide window Settings shows it in its own pane, so this page goes back there. */
export default function NotificationsScreen() {
  const barHeight = useTopBarHeight();
  const insets = useSafeAreaInsets();
  const wide = useWindowClass() === 'wide';

  useEffect(() => {
    if (wide) router.dismissTo({ pathname: '/(tabs)/settings', params: { topic: 'notifications', opened: String(Date.now()) } });
  }, [wide]);
  if (wide) return null;

  return (
    <NotificationSettings
      contentStyle={{ paddingTop: barHeight, paddingRight: CONTENT_PAD + insets.right }}
      onBack={() => router.back()}
      onSaved={() => router.back()}
    />
  );
}
