// Install the JS crash handlers AS EARLY AS POSSIBLE — before any other
// module-level side effect runs. Top-level imports are hoisted but executed
// in order, so this module is the first user code path. The import below has
// the side effect of running `installCrashHandlers()` once.
import '@/lib/install-crash-handlers';

import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { type AuthUser, useAuth } from '@/lib/auth';
import { registerForPushNotifications } from '@/lib/notifications';
import { readAndClearCrash } from '@/lib/crash-reporter';
import { CrashBoundary } from '@/components/CrashBoundary';

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const [crashShown, setCrashShown] = useState(false);

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
        };
        if (
          fresh.role !== user.role ||
          fresh.fullName !== user.fullName ||
          fresh.phone !== user.phone
        ) {
          await setUser(fresh);
        }
      } catch {}
      // Push registration: safe to call every launch (server upserts).
      // Useful even for riders (future ride status updates).
      void registerForPushNotifications();
    })();
  }, [hydrate]);

  return (
    <CrashBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(app)" />
          </Stack>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </CrashBoundary>
  );
}
