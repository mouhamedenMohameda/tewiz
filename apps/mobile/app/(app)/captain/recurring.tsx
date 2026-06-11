import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl,
  ScrollView, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';

type RecurringStatus = 'proposed' | 'active' | 'paused' | 'cancelled' | 'expired';

interface Recurring {
  id: string;
  riderId: string;
  captainId: string | null;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  daysOfWeek: number; // bitmap, bit 0 = Mon
  timeOfDay: string;  // HH:MM:SS
  timezone: string;
  lockedFareKhoums: number;
  status: RecurringStatus;
  validFrom: string;
  validUntil: string | null;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function decodeDays(bitmap: number): string {
  return DAY_LABELS.filter((_, i) => bitmap & (1 << i)).join(', ');
}

export default function RecurringScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Recurring[]>('/captain/recurring-rides');
      setItems(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function accept(id: string) {
    setAccepting(id);
    try {
      await api.post(`/captain/recurring-rides/${id}/accept`);
      await load();
      Alert.alert('Engagement accepté', 'Vous êtes locked-in sur ce trajet.');
    } catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally {
      setAccepting(null);
    }
  }

  const proposed = items.filter((i) => i.status === 'proposed');
  const mine = items.filter((i) => i.status === 'active');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>
        <Text style={{ fontSize: 24, fontWeight: '700', color: '#0f172a', marginTop: 12 }}>
          Courses récurrentes
        </Text>
        <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
          Des passagers proposent des trajets réguliers. Acceptez-en un et le tarif est verrouillé.
        </Text>

        <Section title="Mes engagements">
          {mine.length === 0 ? (
            <Empty text="Aucun trajet récurrent actif." />
          ) : mine.map((it) => (
            <Row key={it.id} item={it}>
              <Pill bg="#dcfce7" fg="#166534" label="LOCKÉ" />
            </Row>
          ))}
        </Section>

        <Section title="Propositions">
          {loading && proposed.length === 0 ? (
            <View style={{ marginTop: 12, alignItems: 'center' }}><ActivityIndicator /></View>
          ) : proposed.length === 0 ? (
            <Empty text="Aucune proposition pour le moment." />
          ) : proposed.map((it) => (
            <Row key={it.id} item={it}>
              <Pressable
                disabled={accepting === it.id}
                onPress={() => accept(it.id)}
                style={({ pressed }) => ({
                  backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
                  paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10,
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  opacity: accepting === it.id ? 0.5 : 1,
                })}
              >
                {accepting === it.id && <ActivityIndicator color="#fff" size="small" />}
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Accepter</Text>
              </Pressable>
            </Row>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 24 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 }}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Text style={{ marginTop: 12, fontSize: 13, color: '#94a3b8' }}>{text}</Text>
  );
}

function Pill({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function Row({ item, children }: { item: Recurring; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 12, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
          {decodeDays(item.daysOfWeek)} · {item.timeOfDay.slice(0, 5)}
        </Text>
        {children}
      </View>

      <View style={{ marginTop: 10 }}>
        <Text style={{ fontSize: 12, color: '#64748b' }}>De</Text>
        <Text style={{ fontSize: 14, color: '#0f172a' }} numberOfLines={1}>
          {item.pickup.label ?? `${item.pickup.lat.toFixed(4)}, ${item.pickup.lng.toFixed(4)}`}
        </Text>
        <Text style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Vers</Text>
        <Text style={{ fontSize: 14, color: '#0f172a' }} numberOfLines={1}>
          {item.dropoff.label ?? `${item.dropoff.lat.toFixed(4)}, ${item.dropoff.lng.toFixed(4)}`}
        </Text>
      </View>

      <View style={{
        marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Text style={{ fontSize: 13, color: '#64748b' }}>Tarif verrouillé</Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a' }}>
          {formatMru(item.lockedFareKhoums)}
        </Text>
      </View>
    </View>
  );
}
