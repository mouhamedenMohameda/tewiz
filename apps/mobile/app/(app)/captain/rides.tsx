import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Pressable, RefreshControl,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';

// Note: the new-ride alert (modal + ringing) is handled globally by
// <CaptainRideWatcher /> mounted in the captain layout, so this screen
// is purely a "browse inbox + drive the current ride" view.

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

type RideType = 'passenger' | 'colis';

interface InboxItem {
  id: string;
  rideType: RideType;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateKhoums: number | null;
  distanceM: number | null;
  distanceToPickupM: number;
  isFavorite: boolean;
  homewardProgressM: number | null;
  requestedAt: string;
}

interface Ride {
  id: string;
  rideType: RideType;
  status: RideStatus;
  passengerName: string | null;
  passengerPhone: string | null;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateKhoums: number | null;
  fareFinalKhoums: number | null;
  commissionKhoums: number | null;
  paymentMethod: 'cash' | 'wallet';
}

export default function RidesScreen() {
  const router = useRouter();
  const [current, setCurrent] = useState<Ride | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const curRes = await api.get<Ride>('/captain/rides/current', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      if (curRes.status === 204) {
        setCurrent(null);
        try {
          const inb = await api.get<InboxItem[]>('/captain/rides/inbox');
          setInbox(inb.data);
        } catch (e: any) {
          if (e.response?.status === 400) {
            setInbox([]); // captain has no known location yet
          } else {
            throw e;
          }
        }
      } else {
        setCurrent(curRes.data);
        setInbox([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while the screen is focused:
  // - waiting for a ride: poll every 5 s so new requests pop in quickly
  // - on a ride: poll every 8 s for status changes (rider cancels, etc.)
  usePolling(load, current ? 8_000 : 5_000);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>

        {current ? (
          <CurrentRideCard ride={current} onChanged={load} />
        ) : (
          <InboxList items={inbox} onAccepted={load} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InboxList({ items, onAccepted }: { items: InboxItem[]; onAccepted: () => void }) {
  const [accepting, setAccepting] = useState<string | null>(null);

  async function accept(id: string) {
    setAccepting(id);
    try {
      await api.post(`/captain/rides/${id}/accept`);
      onAccepted();
    } catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally {
      setAccepting(null);
    }
  }

  return (
    <View>
      <Text style={{ marginTop: 12, fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
        Courses proches
      </Text>
      <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
        Vous devez être en ligne avec votre position partagée.
      </Text>
      {items.length === 0 ? (
        <View style={{
          marginTop: 24, backgroundColor: '#fff', borderRadius: 14, padding: 20, alignItems: 'center',
        }}>
          <Text style={{ color: '#64748b' }}>Aucune course pour le moment.</Text>
        </View>
      ) : items.map((it) => (
        <View key={it.id} style={{
          marginTop: 12, backgroundColor: '#fff', borderRadius: 14, padding: 16,
          borderLeftWidth: 4,
          borderLeftColor: it.isFavorite ? '#f59e0b' : (it.rideType === 'colis' ? '#8b5cf6' : '#10a35e'),
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: it.rideType === 'colis' ? '#6d28d9' : '#0f172a' }}>
              {it.rideType === 'colis' ? '📦 COLIS' : '🚖 PASSAGER'}
              {it.isFavorite ? '  ⭐ FAVORI' : ''}
              {it.homewardProgressM && it.homewardProgressM > 0 ? '  🏠 RAPPROCHE' : ''}
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b' }}>
              {(it.distanceToPickupM / 1000).toFixed(1)} km
            </Text>
          </View>

          <View style={{ marginTop: 12 }}>
            <Text style={{ fontSize: 13, color: '#64748b' }}>De</Text>
            <Text style={{ fontSize: 14, color: '#0f172a' }} numberOfLines={1}>
              {it.pickup.label ?? 'Point de prise en charge'}
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>Vers</Text>
            <Text style={{ fontSize: 14, color: '#0f172a' }} numberOfLines={1}>
              {it.dropoff.label ?? 'Destination'}
            </Text>
          </View>

          <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a' }}>
              {it.fareEstimateKhoums ? formatMru(it.fareEstimateKhoums) : '—'}
            </Text>
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
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Accepter</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

function CurrentRideCard({ ride, onChanged }: { ride: Ride; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); await onChanged(); }
    catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally { setBusy(null); }
  }

  function arrive() {
    return action('arrive', async () => {
      await api.post(`/captain/rides/${ride.id}/arrive`);
    });
  }

  function start() {
    if (!/^\d{4}$/.test(code)) {
      Alert.alert('Code requis', 'Demandez au passager le code à 4 chiffres.');
      return Promise.resolve();
    }
    return action('start', async () => {
      await api.post(`/captain/rides/${ride.id}/start`, { code });
      setCode('');
    });
  }

  async function complete() {
    const body: any = {};
    if (ride.rideType === 'colis') {
      if (!/^\d{4}$/.test(code)) {
        Alert.alert('Code livraison', 'Demandez au destinataire le code reçu par SMS.');
        return;
      }
      body.dropOtp = code;
    }
    // Optional GPS-based actual distance/duration could be added later.
    return action('complete', async () => {
      await api.post(`/captain/rides/${ride.id}/complete`, body);
      setCode('');
    });
  }

  async function cancel() {
    Alert.alert(
      'Annuler la course ?',
      'Cela impacte votre score.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler', style: 'destructive',
          onPress: () => action('cancel', async () => {
            await api.post(`/captain/rides/${ride.id}/cancel`, { reason: 'captain_cancel' });
          }),
        },
      ],
    );
  }

  const stepLabel: Partial<Record<RideStatus, string>> = {
    accepted: 'Acceptée — en route vers le client',
    arrived: 'Arrivé sur place',
    in_progress: 'Course en cours',
  };

  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ backgroundColor: '#0f172a', borderRadius: 16, padding: 20 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#bfdbfe', letterSpacing: 0.5 }}>
          {(stepLabel[ride.status] ?? ride.status).toUpperCase()}
        </Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#fff', marginTop: 8 }}>
          {ride.rideType === 'colis' ? '📦 Colis' : (ride.passengerName ?? 'Passager')}
        </Text>
        {ride.passengerPhone ? (
          <View style={{
            marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <Text style={{ fontSize: 14, color: '#cbd5e1', flex: 1 }}>
              {ride.passengerPhone}{ride.isForOther ? ' · pour un tiers' : ''}
            </Text>
            <Pressable
              onPress={() => Linking.openURL(`tel:${ride.passengerPhone}`)}
              style={({ pressed }) => ({
                backgroundColor: pressed ? '#0a7a45' : '#10a35e',
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                flexDirection: 'row', alignItems: 'center', gap: 6,
              })}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                📞 Appeler
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 12, color: '#94a3b8' }}>De</Text>
          <Text style={{ fontSize: 14, color: '#fff' }} numberOfLines={2}>
            {ride.pickup.label ?? 'Point de prise en charge'}
          </Text>
          <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Vers</Text>
          <Text style={{ fontSize: 14, color: '#fff' }} numberOfLines={2}>
            {ride.dropoff.label ?? 'Destination'}
          </Text>
        </View>

        <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontSize: 12, color: '#94a3b8' }}>Tarif estimé</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff' }}>
              {ride.fareEstimateKhoums ? formatMru(ride.fareEstimateKhoums) : '—'}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 12, color: '#94a3b8' }}>Paiement</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff' }}>
              {ride.paymentMethod === 'cash' ? 'Espèces' : 'Wallet'}
            </Text>
          </View>
        </View>
      </View>

      {/* Step controls */}
      {ride.status === 'accepted' ? (
        <PrimaryAction title="Je suis arrivé" onPress={arrive} busy={busy === 'arrive'} />
      ) : null}

      {ride.status === 'arrived' ? (
        <CodeBox
          title={ride.rideType === 'colis'
            ? 'Code expéditeur (4 chiffres)'
            : 'Code passager (4 chiffres)'}
          subtitle={ride.rideType === 'colis'
            ? 'Demandez le code à l\'expéditeur du colis avant de démarrer.'
            : 'Demandez le code anti-arnaque au passager avant de démarrer.'}
          code={code}
          onChange={setCode}
          actionLabel={ride.rideType === 'colis' ? 'Démarrer la livraison' : 'Démarrer la course'}
          onAction={start}
          busy={busy === 'start'}
        />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'passenger' ? (
        <PrimaryAction title="Terminer la course" onPress={complete} busy={busy === 'complete'} />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'colis' ? (
        <CodeBox
          title="Code livraison (4 chiffres)"
          subtitle="Demandez au destinataire le code reçu par SMS."
          code={code}
          onChange={setCode}
          actionLabel="Confirmer la livraison"
          onAction={complete}
          busy={busy === 'complete'}
        />
      ) : null}

      <Pressable
        onPress={cancel}
        style={({ pressed }) => ({
          marginTop: 16, padding: 14, borderRadius: 12,
          backgroundColor: pressed ? '#fee2e2' : '#fff', alignItems: 'center',
          borderWidth: 1, borderColor: '#fecaca',
        })}
      >
        <Text style={{ color: '#b91c1c', fontSize: 14, fontWeight: '600' }}>Annuler la course</Text>
      </Pressable>
    </View>
  );
}

function PrimaryAction({ title, onPress, busy }: { title: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 16, backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
        opacity: busy ? 0.5 : 1,
        paddingVertical: 16, borderRadius: 12,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      })}
    >
      {busy && <ActivityIndicator color="#fff" />}
      <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

function CodeBox({
  title, subtitle, code, onChange, actionLabel, onAction, busy,
}: {
  title: string; subtitle: string;
  code: string; onChange: (v: string) => void;
  actionLabel: string; onAction: () => void; busy?: boolean;
}) {
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
      <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{title}</Text>
      <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{subtitle}</Text>
      <TextInput
        value={code}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="····"
        placeholderTextColor="#94a3b8"
        style={{
          marginTop: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
          paddingHorizontal: 14, paddingVertical: 16, fontSize: 24,
          color: '#0f172a', backgroundColor: '#f8fafc',
          textAlign: 'center', letterSpacing: 12, fontWeight: '700',
        }}
      />
      <PrimaryAction title={actionLabel} onPress={onAction} busy={busy} />
    </View>
  );
}
