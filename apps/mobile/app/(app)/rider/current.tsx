import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl,
  ScrollView, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import { APP_NAME } from '@/lib/brand';

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
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  paymentMethod: 'cash' | 'wallet';
  verificationCode?: string;
  captain: Captain | null;
}

const STATUS_PALETTE: Record<RideStatus, { bg: string; fg: string }> = {
  pending_passenger_confirm: { bg: '#fef9c3', fg: '#854d0e' },
  searching:                 { bg: '#dbeafe', fg: '#1e40af' },
  accepted:                  { bg: '#dcfce7', fg: '#166534' },
  arrived:                   { bg: '#dcfce7', fg: '#166534' },
  in_progress:               { bg: '#e0e7ff', fg: '#3730a3' },
  completed:                 { bg: '#dcfce7', fg: '#166534' },
  cancelled_by_rider:        { bg: '#fee2e2', fg: '#991b1b' },
  cancelled_by_captain:      { bg: '#fee2e2', fg: '#991b1b' },
  cancelled_by_system:       { bg: '#fee2e2', fg: '#991b1b' },
  no_show:                   { bg: '#fee2e2', fg: '#991b1b' },
};

export default function CurrentRideScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
      t('rider.current.cancelTitle'),
      t('rider.current.cancelBody'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('common.cancel'), style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.post(`/rider/rides/${ride.id}/cancel`, { reason: 'rider_cancel' });
              await load();
            } catch (e: any) {
              Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
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
            <Text style={{ color: '#64748b', fontSize: 14 }}>‹ {t('common.back')}</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#0f172a', textAlign: 'center' }}>
            {t('rider.current.noneTitle')}
          </Text>
          <Text style={{ fontSize: 13, color: '#64748b', marginTop: 8, textAlign: 'center' }}>
            {t('rider.current.noneSub')}
          </Text>
          <Pressable
            onPress={() => router.replace('/(app)/rider/new-ride')}
            style={({ pressed }) => ({
              marginTop: 24, backgroundColor: pressed ? '#0a7a45' : '#10a35e',
              paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12,
            })}
          >
            <Text style={{ color: '#fff', fontWeight: '700' }}>{t('rider.current.order')}</Text>
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
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ {t('common.back')}</Text>
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
              {cancelling ? t('rider.current.cancelling') : t('rider.current.cancelAction')}
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
  const { t } = useTranslation();
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
      Alert.alert(t('rider.current.rating.missingTitle'), t('rider.current.rating.missingBody'));
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
      Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
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
                {t('rider.current.rating.favoriteTitle', {
                  name: captain.fullName ?? t('rider.current.rating.favoriteFallbackName'),
                })}
              </Text>
              <Text style={{ fontSize: 14, color: '#64748b', lineHeight: 20 }}>
                {t('rider.current.rating.favoriteHint')}
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
                  {t('rider.current.rating.favoriteAdd')}
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
                  {t('common.noThanks')}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
                {t('rider.current.rating.question')}
              </Text>
              <Text style={{ fontSize: 14, color: '#64748b' }}>
                {t('rider.current.rating.withDriver', {
                  name: captain.fullName ?? t('rider.current.rating.withDriverFallback'),
                })}
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
                placeholder={t('rider.current.rating.commentPlaceholder')}
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
                  {t('rider.current.rating.submit')}
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
                  {t('common.later')}
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
  const { t } = useTranslation();
  const palette = STATUS_PALETTE[status];
  const title = t(`rider.current.banners.${status}.title` as const);
  const sub = t(`rider.current.banners.${status}.sub` as const, { app: APP_NAME });
  return (
    <View style={{ marginTop: 16, backgroundColor: palette.bg, borderRadius: 14, padding: 16 }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: palette.fg }}>{title}</Text>
      {sub ? <Text style={{ fontSize: 13, color: palette.fg, marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

function CaptainCard({ captain, verificationCode }: { captain: Captain; verificationCode?: string }) {
  const { t } = useTranslation();
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 }}>
        {t('rider.current.yourDriver')}
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
            {captain.fullName ?? t('rider.current.fallbackName')}
          </Text>
          <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            ⭐ {captain.ratingAvg > 0 ? captain.ratingAvg.toFixed(1) : '—'} · {t('rider.current.ridesCount', { count: captain.totalRides })}
          </Text>
        </View>
        <Pressable
          onPress={() => Linking.openURL(`tel:${captain.phone}`)}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#0a7a45' : '#10a35e',
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>📞</Text>
        </Pressable>
      </View>

      {captain.vehicle ? (
        <View style={{
          marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9',
        }}>
          <Text style={{ fontSize: 12, color: '#64748b' }}>{t('rider.current.vehicleLabel')}</Text>
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
            {t('rider.current.codeForDriver')}
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
  const { t } = useTranslation();
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fff', borderRadius: 14, padding: 16, gap: 12 }}>
      <View>
        <Text style={{ fontSize: 12, color: '#64748b' }}>{t('common.from')}</Text>
        <Text style={{ fontSize: 15, color: '#0f172a', marginTop: 2 }}>
          {ride.pickup.label ?? t('rider.history.pickupFallback')}
        </Text>
      </View>
      <View>
        <Text style={{ fontSize: 12, color: '#64748b' }}>{t('common.to')}</Text>
        <Text style={{ fontSize: 15, color: '#0f172a', marginTop: 2 }}>
          {ride.dropoff.label ?? t('rider.history.dropoffFallback')}
        </Text>
      </View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12,
      }}>
        <View>
          <Text style={{ fontSize: 12, color: '#64748b' }}>{t('rider.current.fare')}</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
            {formatMru(ride.fareFinalMru ?? ride.fareEstimateMru ?? 0)}
          </Text>
        </View>
        <View>
          <Text style={{ fontSize: 12, color: '#64748b' }}>{t('rider.current.payment')}</Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>
            {ride.paymentMethod === 'cash' ? t('rider.current.cash') : t('rider.current.wallet')}
          </Text>
        </View>
      </View>
    </View>
  );
}
