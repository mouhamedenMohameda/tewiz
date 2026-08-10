import {
  FlatList, RefreshControl, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlainText as Text, ScreenHeader } from '@/components/ui';
import { useApiQuery } from '@/lib/useApiQuery';
import { formatMru } from '@/lib/format';
import { colors, radius, schemed, statusTone } from '@/theme';

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

interface RideRow {
  id: string;
  status: RideStatus;
  rideType: 'passenger' | 'colis';
  pickup: { label: string | null };
  dropoff: { label: string | null } | null;
  isOpen?: boolean;
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  requestedAt: string;
  completedAt?: string | null;
}

// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const STATUS_PILL = schemed(() => ({
  pending_passenger_confirm: statusTone.pending,
  searching:                 statusTone.pending,
  accepted:                  statusTone.active,
  arrived:                   statusTone.active,
  in_progress:               statusTone.active,
  completed:                 statusTone.done,
  cancelled_by_rider:        statusTone.failed,
  cancelled_by_captain:      statusTone.failed,
  cancelled_by_system:       statusTone.failed,
  no_show:                   statusTone.neutral,
}));

export default function HistoryScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  // React Query rather than a hand-rolled useState+useEffect: coming back to
  // this screen now paints instantly from cache and revalidates behind the
  // scenes, instead of showing an empty list while the network catches up.
  const {
    data: rides = [], isLoading, isFetching, refetch,
  } = useApiQuery<RideRow[]>(['rider', 'rides', 'history'], '/rider/rides/history');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: 20 }}>
        <ScreenHeader title={t('rider.history.title')} onBack={() => router.back()} />
      </View>

      <FlatList
        data={rides}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          isLoading ? null : (
            <View style={{
              backgroundColor: colors.surface, borderRadius: radius.md, padding: 28, alignItems: 'center',
            }}>
              <Text style={{ color: colors.ink2, fontSize: 13 }}>
                {t('rider.history.empty')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pill = STATUS_PILL[item.status];
          return (
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: colors.ink2 }}>
                  {fmtDate(item.requestedAt, i18n.language)}
                </Text>
                <Text style={{
                  fontSize: 11, fontWeight: '700',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
                  backgroundColor: pill.bg, color: pill.fg,
                }}>
                  {t(`rider.historyStatus.${item.status}` as const)}
                </Text>
              </View>
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 13, color: colors.ink }} numberOfLines={1}>
                  ⚫ {item.pickup.label ?? t('rider.history.pickupFallback')}
                </Text>
                <Text style={{ fontSize: 13, color: colors.ink, marginTop: 4 }} numberOfLines={1}>
                  🔴 {item.isOpen && !item.dropoff
                    ? t('rider.current.openDestinationValue')
                    : (item.dropoff?.label ?? t('rider.history.dropoffFallback'))}
                </Text>
              </View>
              <View style={{
                marginTop: 12, paddingTop: 10,
                borderTopWidth: 1, borderTopColor: colors.line,
                flexDirection: 'row', justifyContent: 'space-between',
              }}>
                <Text style={{ fontSize: 12, color: colors.ink2 }}>
                  {item.rideType === 'colis'
                    ? `📦 ${t('rider.history.colis')}`
                    : `🚖 ${t('rider.history.passenger')}`}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
                  {formatMru(item.fareFinalMru ?? item.fareEstimateMru ?? 0)}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}
