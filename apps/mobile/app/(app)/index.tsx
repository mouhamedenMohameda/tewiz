import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function AppRoot() {
  useThemeRepaint();
  const activeMode = useAuth((s) => s.activeMode);
  if (activeMode === 'captain') return <Redirect href="/(app)/captain" />;
  return <Redirect href="/(app)/rider" />;
}
