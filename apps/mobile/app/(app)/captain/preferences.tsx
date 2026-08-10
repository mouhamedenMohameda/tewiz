import { useState } from 'react';
import { ActivityIndicator, Alert, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { AppText, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

interface Preferences {
  acceptsColis: boolean;
  acceptsLongDistance: boolean;
}

type Key = keyof Preferences;

/** Shared cache key — the toggle handler writes to it directly. */
const PREFS_KEY = ['captain', 'preferences'] as const;

export default function CaptainPreferencesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<Key | null>(null);
  const queryClient = useQueryClient();

  const { data: prefs, isFetching, refetch } = useApiQuery<Preferences>(
    PREFS_KEY,
    '/captain/preferences',
  );

  async function toggle(key: Key, next: boolean) {
    if (!prefs) return;
    setBusyKey(key);
    // Optimistic: the toggle visually flips immediately and rolls back on
    // error. Written straight into the query cache so the rollback restores
    // what the cache actually held, not a copy that could have drifted from it.
    const prev = prefs;
    queryClient.setQueryData<Preferences>(PREFS_KEY, { ...prefs, [key]: next });
    try {
      const r = await api.patch<Preferences>('/captain/preferences', { [key]: next });
      queryClient.setQueryData<Preferences>(PREFS_KEY, r.data);
    } catch (e: any) {
      queryClient.setQueryData<Preferences>(PREFS_KEY, prev);
      Alert.alert(
        t('captain.preferences.saveError'),
        e.response?.data?.error?.message ?? '',
      );
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Screen scroll onRefresh={refetch} refreshing={isFetching}>
      <ScreenHeader title={t('captain.preferences.title')} onBack={() => router.back()} />

      <AppText variant="body" color={colors.ink2}>
        {t('captain.preferences.intro')}
      </AppText>

      {prefs ? (
        <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
          <PrefRow
            icon="parcel"
            tint={colors.emberSoft}
            fg={colors.ember}
            title={t('captain.preferences.colis')}
            hint={t('captain.preferences.colisHint')}
            value={prefs.acceptsColis}
            busy={busyKey === 'acceptsColis'}
            onChange={(v) => toggle('acceptsColis', v)}
          />
          <PrefRow
            icon="ride"
            tint={colors.saffronSoft}
            fg={colors.warning}
            title={t('captain.preferences.longDistance')}
            hint={t('captain.preferences.longDistanceHint')}
            value={prefs.acceptsLongDistance}
            busy={busyKey === 'acceptsLongDistance'}
            onChange={(v) => toggle('acceptsLongDistance', v)}
          />
        </View>
      ) : null}
    </Screen>
  );
}

function PrefRow({
  icon, tint, fg, title, hint, value, busy, onChange,
}: {
  icon: 'parcel' | 'ride';
  tint: string;
  fg: string;
  title: string;
  hint: string;
  value: boolean;
  busy: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Card padding={spacing.lg} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
      <View style={{
        width: 46, height: 46, borderRadius: radius.md,
        backgroundColor: tint, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={24} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{title}</AppText>
        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>{hint}</AppText>
      </View>
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: colors.lineStrong, true: fg }}
          thumbColor={colors.white}
          ios_backgroundColor={colors.lineStrong}
        />
      )}
    </Card>
  );
}
