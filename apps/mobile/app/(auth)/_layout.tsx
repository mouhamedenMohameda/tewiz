import { Stack } from 'expo-router';
import { APP_NAME } from '@/lib/brand';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTitle: `${APP_NAME} Captain`,
        headerShadowVisible: false,
      }}
    />
  );
}
