import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  dropoff: { label: string | null };
  fareEstimateKhoums: number | null;
  fareFinalKhoums: number | null;
  requestedAt: string;
  completedAt?: string | null;
}

const STATUS: Record<RideStatus, { label: string; cls: string }> = {
  pending_passenger_confirm: { label: 'Attente',     cls: 'bg-amber' },
  searching:                 { label: 'Recherche',   cls: 'bg-blue' },
  accepted:                  { label: 'Acceptée',    cls: 'bg-indigo' },
  arrived:                   { label: 'Arrivé',      cls: 'bg-indigo' },
  in_progress:               { label: 'En cours',    cls: 'bg-emerald' },
  completed:                 { label: 'Terminée',    cls: 'bg-green' },
  cancelled_by_rider:        { label: 'Annulée',     cls: 'bg-rose' },
  cancelled_by_captain:      { label: 'Annulée',     cls: 'bg-rose' },
  cancelled_by_system:       { label: 'Annulée',     cls: 'bg-rose' },
  no_show:                   { label: 'No-show',     cls: 'bg-slate' },
};

const PILL_BG: Record<string, { bg: string; fg: string }> = {
  'bg-amber':   { bg: '#fef3c7', fg: '#92400e' },
  'bg-blue':    { bg: '#dbeafe', fg: '#1e40af' },
  'bg-indigo':  { bg: '#e0e7ff', fg: '#3730a3' },
  'bg-emerald': { bg: '#d1fae5', fg: '#065f46' },
  'bg-green':   { bg: '#dcfce7', fg: '#166534' },
  'bg-rose':    { bg: '#fee2e2', fg: '#991b1b' },
  'bg-slate':   { bg: '#e2e8f0', fg: '#334155' },
};

export default function HistoryScreen() {
  const router = useRouter();
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
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a', marginTop: 8 }}>
          Mes courses
        </Text>
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
                Aucune course pour le moment.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const pill = PILL_BG[STATUS[item.status].cls]!;
          return (
            <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, color: '#64748b' }}>
                  {fmtDate(item.requestedAt)}
                </Text>
                <Text style={{
                  fontSize: 11, fontWeight: '700',
                  paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                  backgroundColor: pill.bg, color: pill.fg,
                }}>
                  {STATUS[item.status].label}
                </Text>
              </View>
              <View style={{ marginTop: 10 }}>
                <Text style={{ fontSize: 14, color: '#0f172a' }} numberOfLines={1}>
                  ⚫ {item.pickup.label ?? 'Point de départ'}
                </Text>
                <Text style={{ fontSize: 14, color: '#0f172a', marginTop: 4 }} numberOfLines={1}>
                  🔴 {item.dropoff.label ?? 'Destination'}
                </Text>
              </View>
              <View style={{
                marginTop: 12, paddingTop: 10,
                borderTopWidth: 1, borderTopColor: '#f1f5f9',
                flexDirection: 'row', justifyContent: 'space-between',
              }}>
                <Text style={{ fontSize: 12, color: '#64748b' }}>
                  {item.rideType === 'colis' ? '📦 Colis' : '🚖 Passager'}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
                  {formatMru(item.fareFinalKhoums ?? item.fareEstimateKhoums ?? 0)}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}
