import { useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { QuoteUnavailable } from '@/components/QuoteUnavailable';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, Screen, ScreenHeader } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

interface Quote {
  enabled: boolean;
  baseFareMru: number;
  perKmMru: number;
  minFareMru: number;
}

interface Point { lat: number; lng: number; label?: string }

export default function LightMovingScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  // Tariffs barely change between two visits, so this is exactly the kind of
  // value worth caching: re-opening the screen shows the price immediately
  // instead of spinning through a round trip on a 2G link.
  const { data: quote, isError } = useApiQuery<Quote>(
    ['rider', 'quote', 'light-moving'],
    '/rider/rides/light-moving-quote',
    { staleMs: 5 * 60_000 },
  );
  const [loading, setLoading] = useState(false);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);

  async function requestLocation() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) throw new Error('Location denied');
    const loc = await Location.getCurrentPositionAsync();
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  }

  async function pickPickup() {
    try {
      const pt = await requestLocation();
      setPickup({ ...pt, label: 'Ma position' });
    } catch (e) {
      Alert.alert(t('errors.generic'));
    }
  }

  async function start() {
    if (!pickup || !dropoff) {
      Alert.alert('Incomplet', 'Sélectionnez le point A et le point B');
      return;
    }
    setLoading(true);
    try {
      await api.post('/rider/rides', {
        rideType: 'light_moving',
        pickup,
        dropoff,
        paymentMethod: 'cash',
      });
      router.replace('/(app)/rider/current');
    } catch (e: any) {
      Alert.alert(t('errors.generic'), e.response?.data?.error?.message);
    } finally {
      setLoading(false);
    }
  }

  // The old code alerted from the fetch's .catch(). React Query swallows the
  // rejection into `isError`, so without this an outage would leave the user
  // watching a spinner with no explanation.
  if (isError) return <QuoteUnavailable />;
  if (!quote) return <ActivityIndicator />;
  if (!quote.enabled) {
    return (
      <Screen>
        <ScreenHeader title="Déménagement Léger" onBack={() => router.back()} />
        <AppText color={colors.muted} style={{ padding: spacing.lg }}>
          Ce service est actuellement indisponible.
        </AppText>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Déménagement Léger" onBack={() => router.back()} />
      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'space-between' }}>
        <View>
          <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
            Déménager des objets d'un endroit à un autre
          </AppText>
          <Card padding={spacing.lg} style={{ gap: spacing.md }}>
            <View>
              <AppText variant="caption" color={colors.ink2}>POINT A</AppText>
              {pickup ? (
                <View style={{
                  marginTop: spacing.xs,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.sm,
                  borderRadius: radius.xs,
                  backgroundColor: colors.successSoft,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <AppText variant="body" color={colors.success}>{pickup.label}</AppText>
                  <Icon name="check" size={16} color={colors.success} />
                </View>
              ) : (
                <Button
                  title="Utiliser ma position"
                  icon="pin"
                  size="sm"
                  onPress={pickPickup}
                  style={{ marginTop: spacing.xs }}
                />
              )}
            </View>
            <View>
              <AppText variant="caption" color={colors.ink2}>POINT B</AppText>
              {dropoff ? (
                <View style={{
                  marginTop: spacing.xs,
                  paddingVertical: spacing.sm,
                  paddingHorizontal: spacing.sm,
                  borderRadius: radius.xs,
                  backgroundColor: colors.successSoft,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <AppText variant="body" color={colors.success}>{dropoff.label}</AppText>
                  <Icon name="check" size={16} color={colors.success} />
                </View>
              ) : (
                <Button
                  title="Sélectionner destination"
                  icon="pin"
                  size="sm"
                  onPress={() => router.push('/(app)/rider/new-ride?kind=self')}
                  style={{ marginTop: spacing.xs }}
                />
              )}
            </View>
          </Card>
        </View>
        <Button
          title={`Commander · ${formatMru(quote.baseFareMru + quote.minFareMru)}`}
          icon="check"
          onPress={start}
          busy={loading}
          disabled={!pickup || !dropoff}
        />
      </View>
    </SafeAreaView>
  );
}
