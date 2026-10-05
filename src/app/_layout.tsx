import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { Appearance, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RecoveryScreen } from '@/components/RecoveryScreen';
import { SaveErrorBanner } from '@/components/SaveErrorBanner';
import { ThemeFade } from '@/components/ThemeFade';
import { useNotificationSync } from '@/lib/notifications';
import { hydrate, useHydrated, useLoadStatus, useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';

// Keep the (theme-aware) native splash up until saved data, including the
// theme choice, has loaded, so there's no flash of the wrong colors.
SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Keeps reminders in sync. It subscribes to every entry change, so it lives in
 * its own component: a tap re-renders only this (it renders nothing), not the
 * root layout and the navigator tree below it.
 */
function NotificationSync({ enabled }: { enabled: boolean }) {
  useNotificationSync(enabled);
  return null;
}

export default function RootLayout() {
  const hydrated = useHydrated();
  const { status, busy } = useLoadStatus();
  const themePref = useStore((s) => s.settings.theme);
  const { c, isDark } = useTheme();

  useEffect(() => {
    hydrate().finally(() => SplashScreen.hideAsync().catch(() => {}));
  }, []);

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

  // Saved data couldn't be loaded: show recovery instead of an empty app.
  // It stays mounted while a recovery action reloads, so its messages survive.
  if (status === 'error' || (status === 'loading' && busy)) {
    return (
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <RecoveryScreen />
      </GestureHandlerRootView>
    );
  }

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: c.bg }} />;

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
        <NotificationSync enabled={hydrated} />
        <SaveErrorBanner />
        <ThemeFade />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
