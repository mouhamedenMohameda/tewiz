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

  // Declarative redirects so re-mounting `/` (e.g. when the back stack unwinds
  // to the entry route) never fires a navigation from a passive effect — that
  // caused an infinite replace → re-mount → replace loop in the navigator.
  if (!user) return <Redirect href="/(auth)" />;
  // Admins use the web console, not the mobile app.
  if (user.role === 'admin') return <Redirect href="/(auth)" />;
  // Riders and captains both land in (app); the layout there picks rider vs
  // captain UI based on the active mode.
  return <Redirect href="/(app)" />;
}
