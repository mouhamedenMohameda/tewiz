import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import CaptainCredentialsGate from '@/components/CaptainCredentialsGate';

export default function AppLayout() {
  const router = useRouter();
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!hydrated) return;
    if (!user) router.replace('/(auth)');
  }, [hydrated, user, router]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="carpooling/index" />
        <Stack.Screen name="carpooling/publish" />
      </Stack>
      <CaptainCredentialsGate />
    </>
  );
}
