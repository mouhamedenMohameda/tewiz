import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { browseCars, type Car } from '@/lib/carRental';
import { formatMru } from '@/lib/format';
import { AppText, Button, Card, Icon, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { wrapRow } from '@/components/ui';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function CarRentalScreen() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const [cars, setCars] = useState<Car[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [withDriver, setWithDriver] = useState(false);

  const load = useCallback(async () => {
    try {
      setCars(await browseCars({ search, withDriver: withDriver || undefined }));
    } catch {
      setCars([]);
    }
  }, [search, withDriver]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScreenHeader title={t('carRental.title')} onBack={() => router.back()} style={{ paddingHorizontal: spacing.lg }} />

      <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.sm }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('carRental.myCars')} variant="secondary" size="sm" icon="car"
            onPress={() => router.push('/(app)/car-rental/my-cars')} style={{ flex: 1 }} />
          <Button title={t('carRental.myBookings')} variant="secondary" size="sm" icon="calendar"
            onPress={() => router.push('/(app)/car-rental/my-bookings')} style={{ flex: 1 }} />
        </View>
        <TextField value={search} onChangeText={setSearch} placeholder={t('carRental.searchPlaceholder')}
          icon="search" onSubmitEditing={() => void load()} returnKeyType="search" />
        <Pressable
          onPress={() => setWithDriver((v) => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' }}
        >
          <Icon name={withDriver ? 'check' : 'close'} size={16} color={withDriver ? colors.success : colors.muted} />
          <AppText variant="caption" color={withDriver ? colors.ink : colors.muted}>{t('carRental.withDriver')}</AppText>
        </Pressable>
      </View>

      {cars === null ? (
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      ) : (
        <FlatList
          data={cars}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <AppText color={colors.muted} style={{ textAlign: 'center', marginTop: spacing.xl }}>
              {t('carRental.emptyBrowse')}
            </AppText>
          }
          renderItem={({ item }) => (
            <Card padding={0} onPress={() => router.push(`/(app)/car-rental/${item.id}`)} style={{ overflow: 'hidden' }}>
              {item.photos[0] ? (
                <Image source={{ uri: item.photos[0] }} style={{ width: '100%', height: 170 }} contentFit="cover" />
              ) : (
                <View style={{ width: '100%', height: 170, backgroundColor: colors.sunken, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="car" size={40} color={colors.faint} />
                </View>
              )}
              <View style={{ padding: spacing.lg, gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="label" color={colors.ink} style={{ flex: 1 }}>{item.title}</AppText>
                  <AppText variant="label" color={colors.ember}>{t('carRental.pricePerDay', { price: formatMru(item.pricePerDayMru) })}</AppText>
                </View>
                <View style={{ flexDirection: wrapRow, alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Meta icon="pin" text={item.city} />
                  {item.seats ? <Meta icon="person" text={t('carRental.seatsLabel', { count: item.seats })} /> : null}
                  {item.withDriver ? (
                    <View style={{ backgroundColor: colors.emberSoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 }}>
                      <AppText variant="caption" color={colors.ember}>{t('carRental.driverAvail')}</AppText>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Meta({ icon, text }: { icon: 'pin' | 'person'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Icon name={icon} size={13} color={colors.muted} />
      <AppText variant="caption" color={colors.muted}>{text}</AppText>
    </View>
  );
}
