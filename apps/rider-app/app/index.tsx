import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function Entry() {
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={user?.role === 'rider' ? '/(app)/' : '/(auth)/phone'} />;
}
