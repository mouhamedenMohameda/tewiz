import { View } from 'react-native';
import { Stack } from 'expo-router';
import { CaptainRideWatcher } from '@/components/CaptainRideWatcher';
import CaptainTermsGate from '@/components/CaptainTermsGate';
import { CaptainPermissionsGate } from '@/components/CaptainPermissions';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function CaptainLayout() {
  useThemeRepaint();
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {/* Mounted at the layout root so the new-ride alert (sound + modal)
          fires from any captain screen — home, wallet, heatmap, etc. */}
      <CaptainRideWatcher />
      {/* One-time "Tout autoriser" panel, so the captain answers every OS
          permission in one pass instead of being ambushed screen by screen.
          Mounted UNDER the terms gate on purpose: consent comes first. */}
      <CaptainPermissionsGate />
      {/* Blocks already-approved captains until they accept the current terms. */}
      <CaptainTermsGate />
    </View>
  );
}
