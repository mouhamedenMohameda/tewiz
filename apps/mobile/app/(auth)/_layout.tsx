import { Stack } from 'expo-router';
import { APP_NAME } from '@/lib/brand';
import { colors } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function AuthLayout() {
  useThemeRepaint();
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
