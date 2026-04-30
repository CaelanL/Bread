import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettingsBadge } from '@/lib/notifications';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  // Q14: nudges users to Settings when they've dismissed the explainer
  // card but haven't yet enabled notifications.
  const settingsBadge = useSettingsBadge();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(library)"
        options={{
          title: 'Library',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="books.vertical.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
          tabBarBadge: settingsBadge ? '1' : undefined,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null, // Hide this tab for now
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          href: null, // Navigate via InsightsCard, not a tab
        }}
      />
    </Tabs>
  );
}
