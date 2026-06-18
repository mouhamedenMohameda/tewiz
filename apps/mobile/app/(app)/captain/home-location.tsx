import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { Field, PrimaryButton } from '@/lib/form';
import { AppText, Button, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { APP_NAME } from '@/lib/brand';

interface Home {
  captainId: string;
  lat: number;
  lng: number;
  label: string;
  setAt: string;
  lockedUntil: string;
  correctionUsed: boolean;
}

export default function HomeLocationScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [home, setHome] = useState<Home | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<Home>('/captain/home', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      if (r.status === 204) {
        setHome(null);
        setEditing(true);
      } else {
        setHome(r.data);
        setLabel(r.data.label);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (label.trim().length < 2) {
      Alert.alert(t('captain.homeLocation.errorTitle'), t('captain.homeLocation.errorBody'));
      return;
    }
    setSaving(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert(t('captain.state.locationRequiredTitle'), t('captain.homeLocation.locationRequiredBody', { app: APP_NAME }));
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const body = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        label: label.trim(),
        currentLat: loc.coords.latitude,
        currentLng: loc.coords.longitude,
      };
      const method = home ? 'patch' : 'post';
      const r = await api[method]<Home>('/captain/home', body);
      setHome(r.data);
      setEditing(false);
      Alert.alert(
        t('captain.homeLocation.savedTitle'),
        t('captain.homeLocation.savedBody', { date: new Date(r.data.lockedUntil).toLocaleDateString(i18n.language) }),
      );
    } catch (e: any) {
      Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.ember} />
      </SafeAreaView>
    );
  }

  const now = Date.now();
  const lockedUntil = home ? new Date(home.lockedUntil).getTime() : 0;
  const isLocked = home ? lockedUntil > now : false;
  const setAtMs = home ? new Date(home.setAt).getTime() : 0;
  const inCorrectionWindow =
    !!home && !home.correctionUsed && (now - setAtMs) < 48 * 3600_000;
  const canEdit = !home || !isLocked || inCorrectionWindow;

  return (
    <Screen scroll>
      <ScreenHeader title={t('captain.homeLocation.title')} onBack={() => router.back()} />
      <AppText variant="body" color={colors.ink2}>
        {t('captain.homeLocation.intro')}
      </AppText>

      {home && !editing ? (
        <Card padding={spacing.lg} style={{ marginTop: spacing.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <View style={{
              width: 48, height: 48, borderRadius: radius.md,
              backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="home" size={24} color={colors.ember} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="overline" color={colors.muted}>{t('captain.homeLocation.addressLabel')}</AppText>
              <AppText variant="title" numberOfLines={2}>{home.label}</AppText>
            </View>
          </View>
          <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.md }}>
            {home.lat.toFixed(5)}, {home.lng.toFixed(5)}
          </AppText>

          <View style={{
            marginTop: spacing.base, padding: spacing.md, borderRadius: radius.md,
            backgroundColor: isLocked ? colors.saffronSoft : colors.successSoft,
          }}>
            <AppText variant="overline" color={isLocked ? '#9A6711' : '#166534'}>
              {isLocked ? t('captain.homeLocation.locked') : t('captain.homeLocation.editable')}
            </AppText>
            <AppText variant="caption" color={isLocked ? '#9A6711' : '#166534'} style={{ marginTop: 3 }}>
              {isLocked
                ? t('captain.homeLocation.lockedUntil', { date: new Date(home.lockedUntil).toLocaleDateString(i18n.language) })
                : t('captain.homeLocation.lockedDone')}
              {inCorrectionWindow ? t('captain.homeLocation.correctionPossible') : ''}
            </AppText>
          </View>

          {canEdit ? (
            <Button
              title={inCorrectionWindow ? t('captain.homeLocation.correct') : t('captain.homeLocation.edit')}
              variant="secondary"
              icon="pin"
              onPress={() => setEditing(true)}
              style={{ marginTop: spacing.base }}
            />
          ) : null}
        </Card>
      ) : (
        <View style={{ marginTop: spacing.xs }}>
          <Field label={t('captain.homeLocation.addressFieldLabel')} value={label} onChangeText={setLabel}
            placeholder={t('captain.homeLocation.addressPlaceholder')}
            helper={t('captain.homeLocation.addressHelper')} />
          <PrimaryButton title={t('captain.homeLocation.save')} onPress={save} busy={saving} />
          {home ? (
            <Pressable
              onPress={() => { setEditing(false); setLabel(home.label); }}
              style={{ marginTop: spacing.md, padding: spacing.md, alignItems: 'center' }}
            >
              <AppText variant="bodyStrong" color={colors.ink2}>{t('common.cancel')}</AppText>
            </Pressable>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
