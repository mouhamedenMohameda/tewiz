import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function AppLayout() {
  const router = useRouter();
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (hydrated && (!user || user.role !== 'rider')) {
      router.replace('/(auth)/phone');
    }
  }, [hydrated, user, router]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
