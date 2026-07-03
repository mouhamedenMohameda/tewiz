import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl,
  Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';

type RecurringStatus = 'proposed' | 'active' | 'cancelled' | 'ended';

interface Recurring {
  id: string;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  daysOfWeek: number; // bitmap Mon=1..Sun=64
  timeOfDay: string; // HH:MM
  lockedFareMru: number;
  status: RecurringStatus;
  validFrom: string;
  validUntil: string | null;
  captainId: string | null;
}

const STATUS_PILL: Record<RecurringStatus, { bg: string; fg: string }> = {
  proposed:  { bg: '#fef3c7', fg: '#92400e' },
  active:    { bg: '#dcfce7', fg: '#166534' },
  cancelled: { bg: '#fee2e2', fg: '#991b1b' },
  ended:     { bg: '#e2e8f0', fg: '#334155' },
};

export default function RecurringScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [items, setItems] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);

  // Day labels come from the active locale via a fallback list — for
  // brevity we use the first letter of each common.day* fallback to French.
  // The data driven approach keeps it centralized.
  const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  function formatDays(bitmap: number): string {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      if (bitmap & (1 << i)) days.push(DAY_LABELS[i]!);
    }
    return days.join(' · ') || '—';
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<Recurring[]>('/rider/recurring-rides');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function cancel(id: string) {
    Alert.alert(
      t('rider.recurring.cancelTitle'),
      t('rider.recurring.cancelBody'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('common.cancel'), style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/rider/recurring-rides/${id}/cancel`);
              await load();
            } catch (e: any) {
              Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <View style={{ padding: 20 }}>
        <ScreenHeader title={t('rider.recurring.title')} onBack={() => router.back()} />
        <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 18 }}>
          {t('rider.recurring.intro')}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          loading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={{
              backgroundColor: '#fff', borderRadius: 14, padding: 28, alignItems: 'center',
            }}>
              <Text style={{ color: '#0f172a', fontSize: 15, fontWeight: '600' }}>
                {t('rider.recurring.emptyTitle')}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                {t('rider.recurring.emptyBody')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pill = STATUS_PILL[item.status];
          return (
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>
                  {item.timeOfDay}
                </Text>
                <Text style={{
                  fontSize: 11, fontWeight: '700',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                  backgroundColor: pill.bg, color: pill.fg,
                }}>
                  {t(`rider.recurring.status.${item.status}` as const)}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                {formatDays(item.daysOfWeek)}
              </Text>

              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, color: '#0f172a' }} numberOfLines={1}>
                  ⚫ {item.pickup.label ?? t('rider.recurring.pickupFallback')}
                </Text>
                <Text style={{ fontSize: 13, color: '#0f172a', marginTop: 4 }} numberOfLines={1}>
                  🔴 {item.dropoff.label ?? t('rider.recurring.dropoffFallback')}
                </Text>
              </View>

              <View style={{
                marginTop: 12, paddingTop: 10,
                borderTopWidth: 1, borderTopColor: '#f1f5f9',
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <Text style={{ fontSize: 13, color: '#64748b' }}>
                  {t('rider.recurring.lockedFare')}
                </Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
                  {formatMru(item.lockedFareMru)}
                </Text>
              </View>

              {item.status === 'proposed' || item.status === 'active' ? (
                <Pressable
                  onPress={() => cancel(item.id)}
                  style={({ pressed }) => ({
                    marginTop: 10, paddingTop: 10,
                    borderTopWidth: 1, borderTopColor: '#f1f5f9',
                    alignItems: 'center',
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Text style={{ color: '#dc2626', fontSize: 13, fontWeight: '600' }}>
                    {t('common.cancel')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
