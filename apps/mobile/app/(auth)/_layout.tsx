import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#fff' },
        headerTitle: 'Tewiz Captain',
        headerShadowVisible: false,
      }}
    />
  );
}
