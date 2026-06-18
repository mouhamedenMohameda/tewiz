import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { type ActiveMode, useAuth } from '@/lib/auth';
import { AppText, Icon, PressableScale, type IconName } from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';

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
      backgroundColor: colors.sunken,
      borderRadius: radius.pill,
      padding: 4,
      gap: 4,
    }}>
      <Segment label="Passager" icon="person" active={activeMode === 'rider'} onPress={() => pick('rider')} />
      <Segment label="Chauffeur" icon="captain" active={activeMode === 'captain'} onPress={() => pick('captain')} />
    </View>
  );
}

function Segment({ label, icon, active, onPress }: {
  label: string; icon: IconName; active: boolean; onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.97}
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        paddingVertical: 10,
        borderRadius: radius.pill,
        backgroundColor: active ? colors.ember : 'transparent',
        ...(active ? shadow.ember : null),
      }}
    >
      <Icon name={icon} size={17} color={active ? colors.onEmber : colors.muted} />
      <AppText variant="label" color={active ? colors.onEmber : colors.ink2}>{label}</AppText>
    </PressableScale>
  );
}
