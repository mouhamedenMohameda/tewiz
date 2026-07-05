import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, Screen, ScreenHeader, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';

interface Quote {
  enabled: boolean;
  baseFareMru: number;
  perKmMru: number;
  minFareMru: number;
}

interface Point { lat: number; lng: number; label?: string }

export default function ConvoyageScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleDesc, setVehicleDesc] = useState('');
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);

  useEffect(() => {
    api.get<Quote>('/rider/rides/convoyage-quote')
      .then((r) => setQuote(r.data))
      .catch(() => Alert.alert(t('errors.generic')));
  }, []);

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
    if (!pickup || !dropoff || !vehiclePlate.trim()) {
      Alert.alert('Incomplet', 'Remplissez tous les champs');
      return;
    }
    setLoading(true);
    try {
      await api.post('/rider/rides', {
        rideType: 'convoyage',
        pickup,
        dropoff,
        vehiclePlate: vehiclePlate.trim(),
        vehicleDescription: vehicleDesc.trim(),
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
        <ScreenHeader title="Convoyage" onBack={() => router.back()} />
        <AppText color={colors.muted} style={{ padding: spacing.lg }}>
          Cette service est actuellement indisponible.
        </AppText>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScreenHeader title="Convoyage" onBack={() => router.back()} />

      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'space-between' }}>
        <View>
          <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
            Un chauffeur conduira votre véhicule de A vers B
          </AppText>

          <Card padding={spacing.lg} style={{ gap: spacing.md }}>
            <View>
              <AppText variant="caption" color={colors.ink2}>PLAQUE DU VÉHICULE</AppText>
              <TextField
                value={vehiclePlate}
                onChangeText={setVehiclePlate}
                placeholder="1234 AA 01"
                containerStyle={{ marginTop: spacing.xs }}
              />
            </View>

            <View>
              <AppText variant="caption" color={colors.ink2}>DESCRIPTION</AppText>
              <TextField
                value={vehicleDesc}
                onChangeText={setVehicleDesc}
                placeholder="Toyota Corolla blanc (optionnel)"
                containerStyle={{ marginTop: spacing.xs }}
              />
            </View>

            <View>
              <AppText variant="caption" color={colors.ink2}>POINT A</AppText>
              {pickup ? (
                <View
                  style={{
                    marginTop: spacing.xs,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.sm,
                    borderRadius: 8,
                    backgroundColor: colors.successSoft,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
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
                <View
                  style={{
                    marginTop: spacing.xs,
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.sm,
                    borderRadius: 8,
                    backgroundColor: colors.successSoft,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <AppText variant="body" color={colors.success}>{dropoff.label}</AppText>
                  <Icon name="check" size={16} color={colors.success} />
                </View>
              ) : (
                <Button
                  title="Sélectionner destination"
                  icon="pin"
                  size="sm"
                  onPress={() => router.push('/(app)/rider/new-ride?kind=convoyage')}
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
          disabled={!pickup || !dropoff || !vehiclePlate.trim()}
        />
      </View>
    </SafeAreaView>
  );
}
