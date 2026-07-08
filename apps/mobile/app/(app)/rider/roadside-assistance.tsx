import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Screen, ScreenHeader } from '@/components/ui';
import { colors, spacing } from '@/theme';

interface Quote {
  enabled: boolean;
  baseFareMru: number;
}

export default function RoadsideAssistanceScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Quote>('/rider/rides/roadside-assistance-quote')
      .then((r) => setQuote(r.data))
      .catch(() => Alert.alert(t('errors.generic')));
  }, []);

  async function start() {
    setLoading(true);
    try {
      const { getCurrentPositionAsync, requestForegroundPermissionsAsync } = await import('expo-location');
      const perm = await requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location denied');
      const loc = await getCurrentPositionAsync();
      await api.post('/rider/rides', {
        rideType: 'roadside_assistance',
        pickup: {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          label: t('roadside.riderAssist.myPositionLabel'),
        },
        paymentMethod: 'cash',
      });
      router.replace('/(app)/rider/current');
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.response?.data?.error?.message);
    } finally {
      setLoading(false);
    }
  }

  if (!quote) return <ActivityIndicator />;
  if (!quote.enabled) {
    return (
      <Screen>
        <ScreenHeader title={t('roadside.headerRider')} onBack={() => router.back()} />
        <AppText color={colors.muted} style={{ padding: spacing.lg }}>
          {t('roadside.riderAssist.unavailable')}
        </AppText>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader title={t('roadside.headerRider')} onBack={() => router.back()} />
      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'space-between' }}>
        <View>
          <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
            {t('roadside.riderAssist.intro')}
          </AppText>
          <Card padding={spacing.lg}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText variant="body" color={colors.ink2}>{t('roadside.riderAssist.baseFareLabel')}</AppText>
              <AppText variant="h2" color={colors.ember}>{formatMru(quote.baseFareMru)}</AppText>
            </View>
          </Card>
        </View>
        <Button
          title={t('roadside.riderAssist.requestBtn', { price: formatMru(quote.baseFareMru) })}
          icon="check"
          onPress={start}
          busy={loading}
        />
      </View>
    </SafeAreaView>
  );
}
