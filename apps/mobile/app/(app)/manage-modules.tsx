import { Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { APP_MODULES } from '@/lib/modules';
import { useModulePreferences } from '@/lib/modulePreferences';
import { useAppConfig } from '@/lib/appConfig';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function ManageModulesScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const { isEnabled, toggle } = useModulePreferences();
  // Only let the user toggle services the admin has enabled; a service turned
  // off from the admin isn't listed here (and is hidden from the home grid).
  const { modules: moduleFlags } = useAppConfig();
  const modules = APP_MODULES.filter((m) => moduleFlags[m.key] !== false);

  return (
    <Screen scroll>
      <ScreenHeader title={t('settings.modules.section')} onBack={() => router.back()} />

      <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg, lineHeight: 20 }}>
        {t('settings.modules.hint')}
      </AppText>

      <Card padding={spacing.lg} style={{ gap: spacing.lg }}>
        {modules.map((m) => (
          <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
            <View style={{
              width: 46, height: 46, borderRadius: radius.md,
              backgroundColor: m.tint, alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name={m.icon} size={24} color={m.fg} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">
                {t(m.label as any)}
              </AppText>
            </View>
            <Switch
              value={isEnabled(m.key)}
              onValueChange={(v) => toggle(m.key, v)}
              trackColor={{ false: colors.lineStrong, true: colors.ember }}
              thumbColor={colors.white}
              ios_backgroundColor={colors.lineStrong}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}
