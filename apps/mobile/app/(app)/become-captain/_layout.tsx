import { Stack } from 'expo-router';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function BecomeCaptainLayout() {
  useThemeRepaint();
  return <Stack screenOptions={{ headerShown: false }} />;
}
