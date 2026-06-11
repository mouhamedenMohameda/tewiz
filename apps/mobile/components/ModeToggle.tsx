import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { type ActiveMode, useAuth } from '@/lib/auth';

/**
 * Segmented switch — visible only for users whose role is `captain`.
 * Toggling persists the mode and redirects to the matching home.
 * Riders never see this (rendered as null).
 */
export function ModeToggle() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const activeMode = useAuth((s) => s.activeMode);
  const setActiveMode = useAuth((s) => s.setActiveMode);

  if (user?.role !== 'captain') return null;

  async function pick(m: ActiveMode) {
    if (m === activeMode) return;
    await setActiveMode(m);
    router.replace(m === 'captain' ? '/(app)/captain' : '/(app)/rider');
  }

  return (
    <View style={{
      flexDirection: 'row',
      backgroundColor: '#e2e8f0',
      borderRadius: 999,
      padding: 4,
      gap: 4,
    }}>
      <Segment label="Passager" active={activeMode === 'rider'} onPress={() => pick('rider')} />
      <Segment label="Chauffeur" active={activeMode === 'captain'} onPress={() => pick('captain')} />
    </View>
  );
}

function Segment({ label, active, onPress }: {
  label: string; active: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: active ? '#0f172a' : (pressed ? '#cbd5e1' : 'transparent'),
      })}
    >
      <Text style={{
        color: active ? '#fff' : '#475569',
        fontSize: 13,
        fontWeight: '600',
      }}>
        {label}
      </Text>
    </Pressable>
  );
}
