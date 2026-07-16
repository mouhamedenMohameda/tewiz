import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { browseTrips, type FreightTrip } from '@/lib/freight';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader, TextField } from '@/components/ui';
import { colors, spacing } from '@/theme';
import { wrapRow } from '@/components/ui';

export default function FreightScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [trips, setTrips] = useState<FreightTrip[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');

  const load = useCallback(async () => {
    try { setTrips(await browseTrips({ origin, destination })); } catch { setTrips([]); }
  }, [origin, destination]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('freight.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />
      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('freight.myTrips')} variant="secondary" size="sm" icon="ride"
            onPress={() => router.push('/(app)/freight/my-trips')} style={{ flex: 1 }} />
          <Button title={t('freight.myShipments')} variant="secondary" size="sm" icon="parcel"
            onPress={() => router.push('/(app)/freight/my-shipments')} style={{ flex: 1 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}><TextField value={origin} onChangeText={setOrigin} placeholder={t('freight.originPlaceholder')} onSubmitEditing={() => void load()} returnKeyType="search" /></View>
          <View style={{ flex: 1 }}><TextField value={destination} onChangeText={setDestination} placeholder={t('freight.destinationPlaceholder')} onSubmitEditing={() => void load()} returnKeyType="search" /></View>
        </View>
      </View>

      {trips === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={trips}
          keyExtractor={(t2) => t2.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              {t('freight.emptyBrowse')}
            </AppText>
          }
          renderItem={({ item }) => (
            <Card padding={spacing.lg} style={{ gap: spacing.xs }} onPress={() => router.push(`/(app)/freight/${item.id}`)}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{item.originCity} → {item.destinationCity}</AppText>
                <AppText variant="label" color={colors.ember}>{formatMru(item.pricePerKgMru)}/kg</AppText>
              </View>
              <View style={{ flexDirection: wrapRow, alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' }}>
                <Meta icon="calendar" text={item.departureDate} />
                <Meta icon="parcel" text={t('freight.kgAvail', { kg: item.remainingKg })} />
                {item.vehicleType ? <Meta icon="ride" text={item.vehicleType} /> : null}
              </View>
              <AppText variant="caption" color={colors.muted}>{item.carrierName}</AppText>
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Meta({ icon, text }: { icon: 'calendar' | 'parcel' | 'ride'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon name={icon} size={13} color={colors.muted} />
      <AppText variant="caption" color={colors.muted}>{text}</AppText>
    </View>
  );
}
