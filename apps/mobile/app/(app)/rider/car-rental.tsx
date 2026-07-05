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
  dailyRateMru: number;
}

export default function CarRentalScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Quote>('/rider/rides/car-rental-quote')
      .then((r) => setQuote(r.data))
      .catch(() => Alert.alert(t('errors.generic')));
  }, []);

  async function start() {
    setLoading(true);
    try {
      await api.post('/rider/rides', {
        rideType: 'car_rental',
        pickup: { lat: 0, lng: 0 },
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
        <ScreenHeader title="Location Auto" onBack={() => router.back()} />
        <AppText color={colors.muted} style={{ padding: spacing.lg }}>
          Ce service est actuellement indisponible.
        </AppText>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader title="Location Auto" onBack={() => router.back()} />
      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'space-between' }}>
        <View>
          <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
            Louer une voiture à la journée
          </AppText>
          <Card padding={spacing.lg} style={{ gap: spacing.lg }}>
            <View style={{ borderBottomWidth: 1, borderBottomColor: colors.line, paddingBottom: spacing.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="body" color={colors.ink2}>TARIF JOURNALIER</AppText>
                <AppText variant="h2" color={colors.ember}>{formatMru(quote.dailyRateMru)}</AppText>
              </View>
              <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.sm }}>
                Par jour
              </AppText>
            </View>
          </Card>
        </View>
        <Button
          title={`Réserver · ${formatMru(quote.dailyRateMru)}`}
          icon="check"
          onPress={start}
          busy={loading}
        />
      </View>
    </SafeAreaView>
  );
}
