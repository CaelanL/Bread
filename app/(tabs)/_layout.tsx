import { Tabs } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, withAlpha } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettingsBadge } from '@/lib/notifications';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  // Q14: nudges users to Settings when they've dismissed the explainer
  // card but haven't yet enabled notifications.
  const settingsBadge = useSettingsBadge();
  const background = Colors[colorScheme ?? 'light'].background;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        // No hairline: content fades out into the bar instead, from FADE above its top edge.
        tabBarStyle: { borderTopWidth: 0, backgroundColor: 'transparent', elevation: 0 },
        tabBarBackground: () => (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]}>
            <LinearGradient
              pointerEvents="none"
              colors={[withAlpha(background, 0), background]}
              style={styles.fade}
            />
          </View>
        ),
      }}>
      <Tabs.Screen
        name="(home)"
        options={{
          title: 'Home',
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(library)"
        options={{
          title: 'Library',
          tabBarButtonTestID: 'tab-library',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="books.vertical.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarButtonTestID: 'tab-settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
          tabBarBadge: settingsBadge ? '1' : undefined,
        }}
      />
    </Tabs>
  );
}

const FADE = 28;

const styles = StyleSheet.create({
  fade: { position: 'absolute', top: -FADE, left: 0, right: 0, height: FADE },
});
