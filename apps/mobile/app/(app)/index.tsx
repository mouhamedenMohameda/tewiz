import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function AppRoot() {
  const activeMode = useAuth((s) => s.activeMode);
  if (activeMode === 'captain') return <Redirect href="/(app)/captain" />;
  return <Redirect href="/(app)/rider" />;
}
