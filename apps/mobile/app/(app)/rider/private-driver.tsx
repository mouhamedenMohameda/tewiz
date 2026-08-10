import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
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

interface Quote {
  enabled: boolean;
  hourlyRateMru: number;
  minHours: number;
}

export default function PrivateDriverScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [duration, setDuration] = useState(3);
  // Tariffs barely change between two visits, so this is exactly the kind of
  // value worth caching: re-opening the screen shows the price immediately
  // instead of spinning through a round trip on a 2G link.
  const { data: quote, isError } = useApiQuery<Quote>(
    ['rider', 'quote', 'private-driver'],
    '/rider/rides/private-driver-quote',
    { staleMs: 5 * 60_000 },
  );
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location denied');
      const loc = await Location.getCurrentPositionAsync();
      router.push({
        pathname: '/(app)/rider/new-ride',
        params: {
          kind: 'private_driver',
          pickup: JSON.stringify({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          }),
          duration: duration.toString(),
        },
      });
    } catch (e) {
      Alert.alert(t('errors.generic'));
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
        <ScreenHeader title="Captain Privé" onBack={() => router.back()} />
        <AppText color={colors.muted} style={{ padding: spacing.lg }}>
          Cette service est actuellement indisponible.
        </AppText>
      </Screen>
    );
  }

  const total = quote.hourlyRateMru * duration;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScreenHeader title="Captain Privé" onBack={() => router.back()} />

      <View style={{ flex: 1, padding: spacing.lg, justifyContent: 'space-between' }}>
        <View>
          <AppText variant="body" color={colors.ink2} style={{ marginBottom: spacing.lg }}>
            Réservez un Captain pour une durée fixe
          </AppText>

          <Card padding={spacing.lg} style={{ gap: spacing.lg }}>
            <View>
              <AppText variant="overline" color={colors.ink2}>DURÉE</AppText>
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                {[3, 6, 12, 24].map((h) => (
                  <Pressable
                    key={h}
                    onPress={() => setDuration(h)}
                    style={{
                      flex: 1,
                      paddingVertical: spacing.sm,
                      paddingHorizontal: spacing.xs,
                      borderRadius: radius.lg,
                      borderWidth: 2,
                      borderColor: duration === h ? colors.ember : colors.line,
                      backgroundColor: duration === h ? colors.emberSoft : '#fff',
                      alignItems: 'center',
                    }}
                  >
                    <AppText
                      variant="label"
                      color={duration === h ? colors.ember : colors.ink}
                    >
                      {h}h
                    </AppText>
                    <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
                      {formatMru(quote.hourlyRateMru * h)}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <AppText variant="body" color={colors.ink2}>TARIF TOTAL</AppText>
                <AppText variant="h2" color={colors.ember}>{formatMru(total)}</AppText>
              </View>
              <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.sm }}>
                {quote.hourlyRateMru} MRU/h × {duration}h
              </AppText>
            </View>
          </Card>
        </View>

        <Button
          title="Réserver"
          icon="check"
          onPress={start}
          busy={loading}
        />
      </View>
    </SafeAreaView>
  );
}
