import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

interface Captain {
  id: string;
  fullName: string | null;
  phone: string;
  ratingAvg: number;
  totalRides: number;
  vehicle: { plate: string; brand: string; model: string; color: string } | null;
}

interface Ride {
  id: string;
  status: RideStatus;
  rideType: 'passenger' | 'colis';
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateKhoums: number | null;
  fareFinalKhoums: number | null;
  paymentMethod: 'cash' | 'wallet';
  verificationCode?: string;
  captain: Captain | null;
}

export default function CurrentRideScreen() {
  const router = useRouter();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Ride>('/rider/rides/current', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      setRide(r.status === 200 ? r.data : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  usePolling(load, 5_000);

  async function cancel() {
    if (!ride) return;
    Alert.alert(
      'Annuler la course ?',
      'Le chauffeur sera notifié.',
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Annuler', style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.post(`/rider/rides/${ride.id}/cancel`, { reason: 'rider_cancel' });
              await load();
            } catch (e: any) {
              Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!ride) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
        <View style={{ padding: 20 }}>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#0f172a', textAlign: 'center' }}>
            Aucune course en cours
          </Text>
          <Text style={{ fontSize: 13, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
            Commandez une course depuis l'accueil.
          </Text>
          <Pressable
            onPress={() => router.replace('/(app)/rider/new-ride')}
            style={({ pressed }) => ({
              marginTop: 24, backgroundColor: pressed ? '#0a7a45' : '#10a35e',
              paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>Commander</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = ride.status === 'searching'
    || ride.status === 'accepted'
    || ride.status === 'arrived'
    || ride.status === 'in_progress';

  const needsRating = ride.status === 'completed' && !!ride.captain;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>

        <StatusBanner status={ride.status} />

        {ride.captain ? (
          <CaptainCard captain={ride.captain} verificationCode={ride.verificationCode} />
        ) : null}

        <TripCard ride={ride} />

        {isActive ? (
          <Pressable
            disabled={cancelling}
            onPress={cancel}
            style={({ pressed }) => ({
              marginTop: 24, padding: 14, borderRadius: 12,
              backgroundColor: pressed ? '#fee2e2' : '#fff',
              borderWidth: 1, borderColor: '#fecaca',
              alignItems: 'center',
              opacity: cancelling ? 0.5 : 1,
            })}
          >
            <Text style={{ color: '#b91c1c', fontSize: 14, fontWeight: '600' }}>
              {cancelling ? 'Annulation…' : 'Annuler la course'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <RatingSheet
        visible={needsRating}
        ride={ride}
        onDone={async () => { await load(); router.replace('/(app)/rider'); }}
      />
    </SafeAreaView>
  );
}

function RatingSheet({
  visible, ride, onDone,
}: {
  visible: boolean;
  ride: Ride | null;
  onDone: () => void;
}) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [askFavorite, setAskFavorite] = useState(false);

  useEffect(() => {
    if (visible) { setStars(0); setComment(''); setAskFavorite(false); }
  }, [visible, ride?.id]);

  if (!ride || !ride.captain) return null;
  const captain = ride.captain;

  async function submit() {
    if (stars === 0) {
      Alert.alert('Note manquante', 'Touchez 1 à 5 étoiles avant d\'envoyer.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/rider/rides/${ride!.id}/rating`, {
        stars,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      if (stars === 5) {
        setAskFavorite(true);
      } else {
        onDone();
      }
    } catch (e: any) {
      Alert.alert('Impossible', e.response?.data?.error?.message ?? 'Échec.');
    } finally {
      setSubmitting(false);
    }
  }

  async function addFavorite() {
    setSubmitting(true);
    try {
      await api.post('/rider/favorites', { captainId: captain.id });
    } catch {
      // Best effort — silent.
    } finally {
      setSubmitting(false);
      onDone();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{
        flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.7)',
        justifyContent: 'flex-end',
      }}>
        <View style={{
          backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: 24, paddingBottom: 36, gap: 16,
        }}>
          {askFavorite ? (
            <>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
                Ajouter {captain.fullName ?? 'ce chauffeur'} à vos favoris ?
              </Text>
              <Text style={{ fontSize: 14, color: '#64748b', lineHeight: 20 }}>
                Vos favoris sont proposés en premier (pendant 30 s) sur vos
                prochaines courses.
              </Text>
              <Pressable
                disabled={submitting}
                onPress={addFavorite}
                style={({ pressed }) => ({
                  marginTop: 8, backgroundColor: pressed ? '#0a7a45' : '#10a35e',
                  paddingVertical: 16, borderRadius: 12,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: submitting ? 0.6 : 1,
                })}
              >
                {submitting && <ActivityIndicator color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  Ajouter aux favoris
                </Text>
              </Pressable>
              <Pressable
                disabled={submitting}
                onPress={onDone}
                style={({ pressed }) => ({
                  paddingVertical: 12, alignItems: 'center',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ color: '#64748b', fontSize: 14, fontWeight: '600' }}>
                  Non merci
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
                Comment s'est passée la course ?
              </Text>
              <Text style={{ fontSize: 14, color: '#64748b' }}>
                Avec {captain.fullName ?? 'votre chauffeur'}.
              </Text>

              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 8 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} onPress={() => setStars(n)} hitSlop={6}>
                    <Text style={{ fontSize: 42, opacity: n <= stars ? 1 : 0.3 }}>
                      ⭐
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Un commentaire ? (optionnel)"
                placeholderTextColor="#94a3b8"
                multiline
                style={{
                  borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 14,
                  color: '#0f172a', backgroundColor: '#f8fafc',
                  minHeight: 60, textAlignVertical: 'top',
                }}
                maxLength={500}
              />

              <Pressable
                disabled={submitting || stars === 0}
                onPress={submit}
                style={({ pressed }) => ({
                  marginTop: 4, backgroundColor: pressed ? '#0a7a45' : '#10a35e',
                  paddingVertical: 16, borderRadius: 12,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: submitting || stars === 0 ? 0.5 : 1,
                })}
              >
                {submitting && <ActivityIndicator color="#fff" />}
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                  Envoyer la note
                </Text>
              </Pressable>
              <Pressable
                disabled={submitting}
                onPress={onDone}
                style={({ pressed }) => ({
                  paddingVertical: 10, alignItems: 'center',
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text style={{ color: '#64748b', fontSize: 13 }}>
                  Plus tard
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function StatusBanner({ status }: { status: RideStatus }) {
  const map: Record<RideStatus, { bg: string; fg: string; title: string; sub: string }> = {
    pending_passenger_confirm: { bg: '#fef9c3', fg: '#854d0e', title: 'En attente de confirmation', sub: 'Confirmez par SMS.' },
    searching:    { bg: '#dbeafe', fg: '#1e40af', title: 'Recherche d\'un chauffeur', sub: 'Patientez quelques instants…' },
    accepted:     { bg: '#dcfce7', fg: '#166534', title: 'Chauffeur en route', sub: 'Il arrive vers vous.' },
    arrived:      { bg: '#dcfce7', fg: '#166534', title: 'Chauffeur arrivé', sub: 'Communiquez-lui le code pour démarrer.' },
    in_progress:  { bg: '#e0e7ff', fg: '#3730a3', title: 'Course en cours', sub: 'Bon voyage.' },
    completed:    { bg: '#dcfce7', fg: '#166534', title: 'Course terminée', sub: 'Merci d\'avoir voyagé avec Tewiz.' },
    cancelled_by_rider:   { bg: '#fee2e2', fg: '#991b1b', title: 'Annulée par vous', sub: '' },
    cancelled_by_captain: { bg: '#fee2e2', fg: '#991b1b', title: 'Annulée par le chauffeur', sub: '' },
    cancelled_by_system:  { bg: '#fee2e2', fg: '#991b1b', title: 'Annulée', sub: '' },
    no_show:      { bg: '#fee2e2', fg: '#991b1b', title: 'Non présenté', sub: '' },
  };
  const s = map[status];
  return (
    <View style={{ marginTop: 16, backgroundColor: s.bg, borderRadius: 14, padding: 16 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: s.fg }}>{s.title}</Text>
      {s.sub ? <Text style={{ fontSize: 13, color: s.fg, marginTop: 4 }}>{s.sub}</Text> : null}
    </View>
  );
}

function CaptainCard({ captain, verificationCode }: { captain: Captain; verificationCode?: string }) {
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 }}>
        VOTRE CHAUFFEUR
      </Text>
      <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{
          width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 22 }}>👤</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
            {captain.fullName ?? 'Chauffeur'}
          </Text>
          <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            ⭐ {captain.ratingAvg > 0 ? captain.ratingAvg.toFixed(1) : '—'} · {captain.totalRides} courses
          </Text>
        </View>
        <Pressable
          onPress={() => Linking.openURL(`tel:${captain.phone}`)}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#0a7a45' : '#10a35e',
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>📞 Appeler</Text>
        </Pressable>
      </View>

      {captain.vehicle ? (
        <View style={{
          marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9',
        }}>
          <Text style={{ fontSize: 12, color: '#64748b' }}>Véhicule</Text>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a', marginTop: 2 }}>
            {captain.vehicle.color} {captain.vehicle.brand} {captain.vehicle.model}
          </Text>
          <Text style={{
            marginTop: 6, alignSelf: 'flex-start',
            backgroundColor: '#0f172a', color: '#fff',
            paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6,
            fontSize: 13, fontWeight: '700', letterSpacing: 1,
          }}>
            {captain.vehicle.plate}
          </Text>
        </View>
      ) : null}

      {verificationCode ? (
        <View style={{
          marginTop: 12, backgroundColor: '#fef3c7', borderRadius: 10, padding: 12,
        }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400e', letterSpacing: 0.5 }}>
            CODE À COMMUNIQUER AU CHAUFFEUR
          </Text>
          <Text style={{
            fontSize: 32, fontWeight: '800', color: '#7c2d12',
            letterSpacing: 8, marginTop: 4, textAlign: 'center',
          }}>
            {verificationCode}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function TripCard({ ride }: { ride: Ride }) {
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 12 }}>
      <View>
        <Text style={{ fontSize: 12, color: '#64748b' }}>De</Text>
        <Text style={{ fontSize: 15, color: '#0f172a', marginTop: 2 }}>
          {ride.pickup.label ?? 'Point de prise en charge'}
        </Text>
      </View>
      <View>
        <Text style={{ fontSize: 12, color: '#64748b' }}>Vers</Text>
        <Text style={{ fontSize: 15, color: '#0f172a', marginTop: 2 }}>
          {ride.dropoff.label ?? 'Destination'}
        </Text>
      </View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12,
      }}>
        <View>
          <Text style={{ fontSize: 12, color: '#64748b' }}>Tarif</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
            {formatMru(ride.fareFinalKhoums ?? ride.fareEstimateKhoums ?? 0)}
          </Text>
        </View>
        <View>
          <Text style={{ fontSize: 12, color: '#64748b' }}>Paiement</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
            {ride.paymentMethod === 'cash' ? 'Espèces' : 'Wallet'}
          </Text>
        </View>
      </View>
    </View>
  );
}
