import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import { Text, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FONT_CAPS, useFontScale } from '@/components/ui';
import { useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

type TabIconProps = { color: ColorValue; focused: boolean };

function TabIcon({ color, focused, active, inactive }: TabIconProps & { active: IconName; inactive: IconName }) {
  return <Ionicons name={focused ? active : inactive} size={24} color={color as string} />;
}

const icon = (active: IconName, inactive: IconName) =>
  function TabBarIcon(props: TabIconProps) {
    return <TabIcon {...props} active={active} inactive={inactive} />;
  };

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  // Labels scale with the phone's text size up to FONT_CAPS.grid (four fixed-width columns);
  // the bar's height grows with them instead of clipping.
  const labelScale = Math.min(useFontScale(), FONT_CAPS.grid);
  const labelLine = Math.ceil(15 * labelScale);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: 55 + labelLine + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 8,
        },
        tabBarLabel: ({ color, children }) => (
          <Text
            maxFontSizeMultiplier={FONT_CAPS.grid}
            numberOfLines={1}
            style={{ color: color as string, fontSize: 11, lineHeight: 15, fontWeight: '600' }}
          >
            {children}
          </Text>
        ),
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('sunny', 'sunny-outline') }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats', tabBarIcon: icon('stats-chart', 'stats-chart-outline') }} />
      <Tabs.Screen name="habits" options={{ title: 'Habits', tabBarIcon: icon('list', 'list-outline') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings', 'settings-outline') }} />
    </Tabs>
  );
}
