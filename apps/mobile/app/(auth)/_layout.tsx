import { Stack } from 'expo-router';
import { APP_NAME } from '@/lib/brand';
import { colors } from '@/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitle: `${APP_NAME} Captain`,
        headerShadowVisible: false,
      }}
    />
  );
}
