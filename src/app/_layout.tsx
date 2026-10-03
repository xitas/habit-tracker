import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { Appearance, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemeFade } from '@/components/ThemeFade';
import { useNotificationSync } from '@/lib/notifications';
import { hydrate, useHydrated, useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

// Keep the (theme-aware) native splash up until saved data, including the
// theme choice, has loaded, so there's no flash of the wrong colors.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const hydrated = useHydrated();
  const themePref = useStore((s) => s.settings.theme);
  const { c, isDark } = useTheme();

  useEffect(() => {
    hydrate().finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, []);
  useNotificationSync(hydrated);

  // Make native UI (alerts, keyboard, pickers) follow the in-app choice.
  useEffect(() => {
    if (!hydrated || Platform.OS === 'web') return;
    Appearance.setColorScheme(themePref === 'system' ? 'unspecified' : themePref);
  }, [hydrated, themePref]);

  // The native root view shows behind screens during transitions and keyboard animations.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bg).catch(() => {});
  }, [c.bg]);

  const navTheme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: isDark,
      colors: {
        ...base.colors,
        background: c.bg,
        card: c.bg,
        text: c.text,
        border: c.border,
        primary: c.accent,
        notification: c.danger,
      },
    };
  }, [c, isDark]);

  if (!hydrated) return <View style={{ flex: 1, backgroundColor: c.bg }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: c.bg },
            headerTintColor: c.text,
            headerTitleStyle: { fontWeight: '600', color: c.text },
            contentStyle: { backgroundColor: c.bg },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="habit/new" options={{ presentation: 'modal', title: 'New habit' }} />
          <Stack.Screen name="habit/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="habit/[id]/edit" options={{ presentation: 'modal', title: 'Edit habit' }} />
        </Stack>
        <ThemeFade />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
