// Install the JS crash handlers AS EARLY AS POSSIBLE — before any other
// module-level side effect runs. Top-level imports are hoisted but executed
// in order, so this module is the first user code path. The import below has
// the side effect of running `installCrashHandlers()` once.
import '@/lib/install-crash-handlers';

import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { type AuthUser, useAuth } from '@/lib/auth';
import { registerForPushNotifications } from '@/lib/notifications';
import { readAndClearCrash } from '@/lib/crash-reporter';
import { CrashBoundary } from '@/components/CrashBoundary';
import { colors, fontAssets } from '@/theme';

// Hold the native splash until our custom fonts are ready, so the UI never
// flashes the system font and re-flows.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const [crashShown, setCrashShown] = useState(false);
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  // Show the previous crash (if any) as an Alert on first mount.
  useEffect(() => {
    if (crashShown) return;
    setCrashShown(true);
    void (async () => {
      const crash = await readAndClearCrash();
      if (!crash) return;
      Alert.alert(
        `Crash précédent (${crash.label})`,
        `${crash.message}\n\n${(crash.stack ?? '').slice(0, 1500)}`,
        [{ text: 'OK' }],
      );
    })();
  }, [crashShown]);

  useEffect(() => {
    (async () => {
      await hydrate();
      // After hydrating from disk, sync the user from the server. The cached
      // role can be stale (rider promoted to captain server-side, language
      // changed, name edited, etc.). Silent failure: offline or 401 keeps
      // the cached user; the refresh interceptor handles token expiry.
      const { user, setUser } = useAuth.getState();
      if (!user) return;
      try {
        const r = await api.get<AuthUser & { language: string }>('/auth/me');
        const fresh = {
          id: r.data.id,
          phone: r.data.phone,
          role: r.data.role,
          fullName: r.data.fullName,
          isGuest: r.data.isGuest ?? false,
        };
        if (
          fresh.role !== user.role ||
          fresh.fullName !== user.fullName ||
          fresh.phone !== user.phone ||
          fresh.isGuest !== (user.isGuest ?? false)
        ) {
          await setUser(fresh);
        }
      } catch {}
      // Push registration: safe to call every launch (server upserts).
      // Useful even for riders (future ride status updates).
      void registerForPushNotifications();
    })();
  }, [hydrate]);

  // Don't render the app shell until fonts resolve (or fail) — avoids a
  // flash-of-system-font. On font error we still proceed (system fallback).
  const ready = fontsLoaded || !!fontError;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <CrashBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.canvas },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </CrashBoundary>
  );
}
