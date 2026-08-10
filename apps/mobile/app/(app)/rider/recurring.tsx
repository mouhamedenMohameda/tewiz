import {
  ActivityIndicator, Alert, FlatList, Pressable, RefreshControl,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlainText as Text, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { formatMru } from '@/lib/format';
import { colors, radius, statusTone } from '@/theme';

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
  proposed:  { bg: statusTone.pending.bg, fg: statusTone.pending.fg },
  active:    { bg: statusTone.done.bg, fg: statusTone.done.fg },
  cancelled: { bg: colors.dangerSoft, fg: statusTone.failed.fg },
  ended:     { bg: colors.line, fg: colors.ink2 },
};

export default function RecurringScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    data: items = [], isLoading, isFetching, refetch,
  } = useApiQuery<Recurring[]>(['rider', 'recurring-rides'], '/rider/recurring-rides');

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
              await refetch();
            } catch (e: any) {
              Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
            }
          },
        },
      ],
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <View style={{ padding: 20 }}>
        <ScreenHeader title={t('rider.recurring.title')} onBack={() => router.back()} />
        <Text style={{ fontSize: 13, color: colors.ink2, marginTop: 4, lineHeight: 18 }}>
          {t('rider.recurring.intro')}
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} />}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ padding: 40, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <View style={{
              backgroundColor: colors.surface, borderRadius: radius.md, padding: 28, alignItems: 'center',
            }}>
              <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>
                {t('rider.recurring.emptyTitle')}
              </Text>
              <Text style={{ color: colors.ink2, fontSize: 13, marginTop: 6, textAlign: 'center' }}>
                {t('rider.recurring.emptyBody')}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pill = STATUS_PILL[item.status];
          return (
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 21, fontWeight: '700', color: colors.ink }}>
                  {item.timeOfDay}
                </Text>
                <Text style={{
                  fontSize: 11, fontWeight: '700',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
                  backgroundColor: pill.bg, color: pill.fg,
                }}>
                  {t(`rider.recurring.status.${item.status}` as const)}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: colors.ink2, marginTop: 4 }}>
                {formatDays(item.daysOfWeek)}
              </Text>

              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, color: colors.ink }} numberOfLines={1}>
                  ⚫ {item.pickup.label ?? t('rider.recurring.pickupFallback')}
                </Text>
                <Text style={{ fontSize: 13, color: colors.ink, marginTop: 4 }} numberOfLines={1}>
                  🔴 {item.dropoff.label ?? t('rider.recurring.dropoffFallback')}
                </Text>
              </View>

              <View style={{
                marginTop: 12, paddingTop: 10,
                borderTopWidth: 1, borderTopColor: colors.line,
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <Text style={{ fontSize: 13, color: colors.ink2 }}>
                  {t('rider.recurring.lockedFare')}
                </Text>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
                  {formatMru(item.lockedFareMru)}
                </Text>
              </View>

              {item.status === 'proposed' || item.status === 'active' ? (
                <Pressable
                  onPress={() => cancel(item.id)}
                  style={({ pressed }) => ({
                    marginTop: 10, paddingTop: 10,
                    borderTopWidth: 1, borderTopColor: colors.line,
                    alignItems: 'center',
                    opacity: pressed ? 0.5 : 1,
                  })}
                >
                  <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
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
