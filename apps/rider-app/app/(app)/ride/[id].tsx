import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';

interface Ride {
  id: string;
  status:
    | 'searching' | 'accepted' | 'arrived' | 'in_progress'
    | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain' | 'cancelled_by_system'
    | 'pending_passenger_confirm';
  captainId: string | null;
  verificationCode?: string | null;
  fareEstimateKhoums: number | null;
  fareFinalKhoums: number | null;
  distanceM: number | null;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  requestedAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_LABELS: Record<Ride['status'], string> = {
  pending_passenger_confirm: 'En attente de confirmation',
  searching: '🔎 Recherche d’un chauffeur',
  accepted: '🚕 Chauffeur en route',
  arrived: '📍 Chauffeur arrivé',
  in_progress: '🛣️ Trajet en cours',
  completed: '✅ Terminé',
  cancelled_by_rider: '✕ Annulé par vous',
  cancelled_by_captain: '✕ Annulé par le chauffeur',
  cancelled_by_system: '✕ Annulé (système)',
};

export default function RideScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ride, setRide] = useState<Ride | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Poll every 3s while ride is active.
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const r = await api.get<Ride>(`/rider/rides/${id}`);
        if (!cancelled) setRide(r.data);
      } catch (e: any) {
        if (!cancelled) setErr(e.response?.data?.error?.message ?? 'Erreur');
      }
    }
    tick();
    interval = setInterval(() => {
      if (
        ride && (
          ride.status === 'completed' ||
          ride.status.startsWith('cancelled')
        )
      ) {
        if (interval) clearInterval(interval);
        return;
      }
      tick();
    }, 3000);

    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [id, ride?.status]);

  async function cancel() {
    Alert.alert(
      'Annuler la course ?',
      'Le chauffeur sera notifié.',
      [
        { text: 'Non' },
        {
          text: 'Oui, annuler', style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/rider/rides/${id}/cancel`, { reason: 'plus besoin' });
              router.replace('/(app)/');
            } catch (e: any) {
              Alert.alert('Erreur', e.response?.data?.error?.message ?? 'Erreur');
            }
          },
        },
      ],
    );
  }

  function newRide() {
    router.replace('/(app)/');
  }

  if (!ride) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
        {err && <Text style={{ marginTop: 12, color: '#dc2626' }}>{err}</Text>}
      </View>
    );
  }

  const showCode = !!ride.verificationCode &&
    ['searching', 'accepted', 'arrived'].includes(ride.status);
  const canCancel = ['searching', 'accepted', 'arrived'].includes(ride.status);
  const finished = ride.status === 'completed' || ride.status.startsWith('cancelled');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        {/* Status */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>{STATUS_LABELS[ride.status]}</Text>
          {ride.status === 'searching' && (
            <Text style={styles.statusSub}>
              Nous cherchons un chauffeur près de chez vous...
            </Text>
          )}
          {ride.status === 'accepted' && (
            <Text style={styles.statusSub}>
              Le chauffeur arrive pour vous récupérer.
            </Text>
          )}
          {ride.status === 'arrived' && (
            <Text style={styles.statusSub}>
              Le chauffeur est sur place. Donnez-lui le code ci-dessous.
            </Text>
          )}
          {ride.status === 'in_progress' && (
            <Text style={styles.statusSub}>En route vers votre destination.</Text>
          )}
        </View>

        {/* Verification code */}
        {showCode && (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Votre code de vérification</Text>
            <Text style={styles.code}>{ride.verificationCode}</Text>
            <Text style={styles.codeHint}>
              À donner au chauffeur avant de monter
            </Text>
          </View>
        )}

        {/* Fare */}
        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Tarif estimé</Text>
            <Text style={styles.detailValue}>
              {formatMru(ride.fareEstimateKhoums ?? 0)}
            </Text>
          </View>
          {ride.fareFinalKhoums !== null && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Tarif final</Text>
              <Text style={[styles.detailValue, { color: '#16a34a' }]}>
                {formatMru(ride.fareFinalKhoums)}
              </Text>
            </View>
          )}
          {ride.distanceM !== null && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Distance</Text>
              <Text style={styles.detailValue}>
                {(ride.distanceM / 1000).toFixed(1)} km
              </Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Paiement</Text>
            <Text style={styles.detailValue}>Espèces</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={{ marginTop: 16, gap: 8 }}>
          {canCancel && (
            <Pressable onPress={cancel} style={styles.btnDanger}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Annuler la course</Text>
            </Pressable>
          )}
          {finished && (
            <Pressable onPress={newRide} style={styles.btnPrimary}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>Nouvelle course</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    backgroundColor: '#fff', padding: 20, borderRadius: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  statusLabel: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  statusSub: { fontSize: 14, color: '#64748b', marginTop: 6 },

  codeCard: {
    backgroundColor: '#2d4fd6', padding: 24, borderRadius: 16, marginTop: 16,
    alignItems: 'center',
  },
  codeLabel: { color: '#bfdbfe', fontSize: 12, fontWeight: '600' },
  code: {
    color: '#fff', fontSize: 56, fontWeight: '800',
    letterSpacing: 12, marginVertical: 8,
  },
  codeHint: { color: '#dbeafe', fontSize: 12 },

  detailsCard: {
    backgroundColor: '#fff', padding: 16, borderRadius: 16, marginTop: 16,
    gap: 10,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailLabel: { color: '#64748b' },
  detailValue: { color: '#0f172a', fontWeight: '600' },

  btnPrimary: {
    backgroundColor: '#2d4fd6', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDanger: {
    backgroundColor: '#dc2626', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
});
