import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';

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

const STATUS_PILL: Record<RideStatus, { bg: string; fg: string }> = {
  pending_passenger_confirm: { bg: '#fef3c7', fg: '#92400e' },
  searching:                 { bg: '#dbeafe', fg: '#1e40af' },
  accepted:                  { bg: '#e0e7ff', fg: '#3730a3' },
  arrived:                   { bg: '#e0e7ff', fg: '#3730a3' },
  in_progress:               { bg: '#d1fae5', fg: '#065f46' },
  completed:                 { bg: '#dcfce7', fg: '#166534' },
  cancelled_by_rider:        { bg: '#fee2e2', fg: '#991b1b' },
  cancelled_by_captain:      { bg: '#fee2e2', fg: '#991b1b' },
  cancelled_by_system:       { bg: '#fee2e2', fg: '#991b1b' },
  no_show:                   { bg: '#e2e8f0', fg: '#334155' },
};

export default function HistoryScreen() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const [rides, setRides] = useState<RideRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<RideRow[]>('/rider/rides/history');
      setRides(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View style={{ padding: 20 }}>
        <ScreenHeader title={t('rider.history.title')} onBack={() => router.back()} />
      </View>

      <FlatList
        data={rides}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          loading ? null : (
            <View style={{
              backgroundColor: '#fff', borderRadius: 14, padding: 28, alignItems: 'center',
            }}>
              <Text style={{ color: '#64748b', fontSize: 14 }}>
                {t('rider.history.empty')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pill = STATUS_PILL[item.status];
          return (
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#64748b' }}>
                  {fmtDate(item.requestedAt, i18n.language)}
                </Text>
                <Text style={{
                  fontSize: 11, fontWeight: '700',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                  backgroundColor: pill.bg, color: pill.fg,
                }}>
                  {t(`rider.historyStatus.${item.status}` as const)}
                </Text>
              </View>
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 14, color: '#0f172a' }} numberOfLines={1}>
                  ⚫ {item.pickup.label ?? t('rider.history.pickupFallback')}
                </Text>
                <Text style={{ fontSize: 14, color: '#0f172a', marginTop: 4 }} numberOfLines={1}>
                  🔴 {item.isOpen && !item.dropoff
                    ? t('rider.current.openDestinationValue')
                    : (item.dropoff?.label ?? t('rider.history.dropoffFallback'))}
                </Text>
              </View>
              <View style={{
                marginTop: 12, paddingTop: 10,
                borderTopWidth: 1, borderTopColor: '#f1f5f9',
                flexDirection: 'row', justifyContent: 'space-between',
              }}>
                <Text style={{ fontSize: 12, color: '#64748b' }}>
                  {item.rideType === 'colis'
                    ? `📦 ${t('rider.history.colis')}`
                    : `🚖 ${t('rider.history.passenger')}`}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
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
