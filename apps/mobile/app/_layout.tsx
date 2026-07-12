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
// Importing this module also runs its top-level side effects (defines the
// background ride-alert task + Notifee background handler).
import { registerBackgroundRideAlertTask } from '@/lib/fullScreenRideAlert';
// Import for side effect: defines the background off-ride location task so the
// OS can invoke it once the captain starts tracking (Level B).
import '@/lib/track-task';
import { readAndClearCrash } from '@/lib/crash-reporter';
import { initI18n } from '@/lib/i18n';
import { loadAppConfig } from '@/lib/appConfig';
import { CrashBoundary } from '@/components/CrashBoundary';
import { NotificationTapHandler } from '@/components/NotificationTapHandler';
import { SplashGate } from '@/components/SplashGate';
import { colors, latinFontAssets } from '@/theme';

// Hold the native splash until our custom fonts are ready, so the UI never
// flashes the system font and re-flows.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const [crashShown, setCrashShown] = useState(false);
  const [fontsLoaded, fontError] = useFonts(latinFontAssets);
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    initI18n().finally(() => {
      if (mounted) setI18nReady(true);
    });
    // Fire-and-forget: populate the in-memory + AsyncStorage config cache.
    // The auth screens read it synchronously via getAppConfig() once i18n is ready.
    void loadAppConfig();
    return () => { mounted = false; };
  }, []);

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
      // Android-only: register the headless task that pops the full-screen
      // "incoming ride" screen when a ride push lands while the app is
      // backgrounded or killed. No-op on iOS / old builds.
      void registerBackgroundRideAlertTask();
    })();
  }, [hydrate]);

  // Don't render the app shell until fonts resolve (or fail) — avoids a
  // flash-of-system-font. On font error we still proceed (system fallback).
  // Also gate on i18n so the first paint already has translations.
  const ready = (fontsLoaded || !!fontError) && i18nReady;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <CrashBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <SafeAreaProvider>
          <SplashGate>
            <StatusBar style="dark" />
            <NotificationTapHandler />
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
          </SplashGate>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </CrashBoundary>
  );
}
