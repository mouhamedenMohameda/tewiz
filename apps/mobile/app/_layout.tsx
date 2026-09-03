// Install the JS crash handlers AS EARLY AS POSSIBLE — before any other
// module-level side effect runs. Top-level imports are hoisted but executed
// in order, so this module is the first user code path. The import below has
// the side effect of running `installCrashHandlers()` once.
import '@/lib/install-crash-handlers';

import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { type AuthUser, useAuth } from '@/lib/auth';
import { registerForPushNotifications } from '@/lib/notifications';
// Importing this module also runs its top-level side effects (defines the
// background ride-alert task + Notifee background handler).
import { attachRideAlertListener, registerBackgroundRideAlertTask } from '@/lib/fullScreenRideAlert';
// Import for side effect: defines the background off-ride location task so the
// OS can invoke it once the captain starts tracking (Level B).
import '@/lib/track-task';
import { readAndClearCrash } from '@/lib/crash-reporter';
import { initI18n, startTranslationSync } from '@/lib/i18n';
import { initThemePreference } from '@/lib/themePreference';
import { loadAppConfig } from '@/lib/appConfig';
import { CrashBoundary } from '@/components/CrashBoundary';
import { NotificationTapHandler } from '@/components/NotificationTapHandler';
import { SplashGate } from '@/components/SplashGate';
import UpdateGate from '@/components/UpdateGate';
import { AppQueryProvider } from '@/lib/queryClient';
import { colors } from '@/theme';
import { ThemeProvider, useScheme } from '@/theme/ThemeProvider';
import fontAssets from '@/theme/fontAssets';

// Hold the native splash until our custom fonts are ready, so the UI never
// flashes the system font and re-flows.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const userId = useAuth((s) => s.user?.id);
  const role = useAuth((s) => s.user?.role);
  const [crashShown, setCrashShown] = useState(false);
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    let stopTranslationSync: (() => void) | undefined;
    // Le thème est chargé avec i18n, pas après : les deux conditionnent le
    // premier rendu, et une préférence lue trop tard ferait clignoter l'app
    // dans la palette du système avant de basculer sur celle du Captain.
    Promise.all([initI18n(), initThemePreference()]).finally(() => {
      if (mounted) setI18nReady(true);
      // Pull any admin-side translation corrections published since the JSON
      // bundled in this binary was built, then keep checking on foreground.
      stopTranslationSync = startTranslationSync();
    });
    // Fire-and-forget: populate the in-memory + AsyncStorage config cache.
    // The auth screens read it synchronously via getAppConfig() once i18n is ready.
    void loadAppConfig();
    return () => { mounted = false; stopTranslationSync?.(); };
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
          isTester: r.data.isTester ?? false,
        };
        if (
          fresh.role !== user.role ||
          fresh.fullName !== user.fullName ||
          fresh.phone !== user.phone ||
          fresh.isGuest !== (user.isGuest ?? false) ||
          fresh.isTester !== (user.isTester ?? false)
        ) {
          await setUser(fresh);
        }
      } catch {}
    })();
  }, [hydrate]);

  // Push registration: reactive to the signed-in user rather than only
  // firing on cold start. `hydrate()` above only populates `user` from a
  // previously *persisted* session — a fresh login during the current app
  // session (phone.tsx / guest.ts) never re-runs the effect above, so
  // without this a just-logged-in user could go a whole session with no
  // push token registered. Safe to call every time the user id appears/
  // changes: the server upserts by (user_id, device_id).
  useEffect(() => {
    if (!userId) return;
    // Captains must NOT be prompted here: their notification ask belongs to the
    // single "Tout autoriser" panel (components/CaptainPermissions.tsx), which
    // calls this back once granted. Prompting on login too would put a dialog
    // in front of them before that panel ever appears — the exact scattering we
    // set out to remove. Registration still runs when the permission is already
    // granted, so a returning captain keeps their push token.
    void registerForPushNotifications({ prompt: role !== 'captain' });
    // Android-only: register the headless task that pops the full-screen
    // "incoming ride" screen when a ride push lands while the app is
    // backgrounded or killed. No-op on iOS / old builds.
    void registerBackgroundRideAlertTask();
  }, [userId, role]);

  // Second trigger for the same full-screen alert, covering every case where
  // the app process is alive (the normal state for an online captain, kept up
  // by the location foreground service). The headless task above only fires
  // once the JS runtime is ready, so on a cold start the push could be lost.
  // Both paths post the same Notifee id, so they can never stack.
  useEffect(() => attachRideAlertListener(), []);

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
      {/* Outermost themed boundary: everything below reads the design tokens,
          and this is what re-renders them when the OS scheme flips. */}
      <ThemeProvider>
        <AppQueryProvider>
          {/* Was <GestureHandlerRootView>. Nothing in this app uses
              react-native-gesture-handler — no Swipeable, no RectButton, no
              gesture-handler list — since the BottomSheet was rewritten onto
              PanResponder. All the root view did was pull the whole
              gesture-handler + Reanimated + Worklets native runtime into
              startup for zero used functionality, on the low-end Android
              hardware this app targets. A plain flex container now. */}
          <View style={{ flex: 1, backgroundColor: colors.canvas }}>
            <SafeAreaProvider>
              <SplashGate>
                <ThemedStatusBar />
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
                {/* Blocks outdated builds; renders above everything else. */}
                <UpdateGate />
              </SplashGate>
            </SafeAreaProvider>
          </View>
        </AppQueryProvider>
      </ThemeProvider>
    </CrashBoundary>
  );
}

/**
 * The status bar carries the OPPOSITE polarity to the canvas: dark glyphs on
 * the light sand, light glyphs on the dark. Hardcoding "dark" left the clock
 * and battery invisible the moment the app went dark.
 */
function ThemedStatusBar() {
  return <StatusBar style={useScheme() === 'dark' ? 'light' : 'dark'} />;
}
