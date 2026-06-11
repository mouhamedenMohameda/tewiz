import { View } from 'react-native';
import { Stack } from 'expo-router';
import { CaptainRideWatcher } from '@/components/CaptainRideWatcher';

export default function CaptainLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false }} />
      {/* Mounted at the layout root so the new-ride alert (sound + modal)
          fires from any captain screen — home, wallet, heatmap, etc. */}
      <CaptainRideWatcher />
    </View>
  );
}
