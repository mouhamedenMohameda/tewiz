import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Linking, Pressable, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { usePolling } from '@/lib/usePolling';
import {
  AppText, Button, Card, Icon, PressableScale, Screen, ScreenHeader, type IconName,
} from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

// Note: the new-ride alert (modal + ringing) is handled globally by
// <CaptainRideWatcher /> mounted in the captain layout, so this screen
// is purely a "browse inbox + drive the current ride" view.

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

type RideType = 'passenger' | 'colis';

type RideSource = 'app' | 'operator';

interface InboxItem {
  id: string;
  rideType: RideType;
  source?: RideSource;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null } | null;
  fareEstimateMru: number | null;
  distanceM: number | null;
  distanceToPickupM: number;
  isFavorite: boolean;
  homewardProgressM: number | null;
  requestedAt: string;
  isOpen?: boolean;
}

interface Ride {
  id: string;
  rideType: RideType;
  status: RideStatus;
  passengerName: string | null;
  passengerPhone: string | null;
  rider?: { id: string; fullName: string | null; phone: string | null } | null;
  isForOther: boolean;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null } | null;
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  commissionMru: number | null;
  paymentMethod: 'cash' | 'wallet';
  isOpen: boolean;
  openTariff: {
    baseFareMru: number;
    perKmMru: number;
    perMinuteMru: number;
    minFareMru: number;
  } | null;
  liveMeter: { distanceM: number; durationS: number; fareMru: number } | null;
}

/**
 * Captain-side GPS pinger for open rides. While the captain has an open
 * ride in_progress, watch position and POST every accepted sample to
 * `/captain/rides/:id/location`. The server rejects teleports / bad-accuracy
 * fixes — those are kept silent because the next sample will succeed.
 *
 * Throttles to one push every ~5 s on top of the OS-level distanceInterval.
 * This is what makes the rider's live meter "fiable": the captain device
 * never computes the fare locally, it just streams coordinates.
 */
function useOpenRideMeterPinger(ride: Ride | null) {
  const lastPushRef = useRef(0);
  useEffect(() => {
    if (!ride || !ride.isOpen || ride.status !== 'in_progress') return;

    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    const rideId = ride.id;

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted' || cancelled) return;
      try {
        sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 10,        // OS callback when moved 10 m
            timeInterval: 3_000,         // …or every 3 s, whichever first
          },
          async (pos) => {
            const now = Date.now();
            if (now - lastPushRef.current < 4_500) return; // throttle to ~5 s
            lastPushRef.current = now;
            try {
              await api.post(`/captain/rides/${rideId}/location`, {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracyM: pos.coords.accuracy ?? undefined,
                speedMps: pos.coords.speed ?? undefined,
                recordedAt: pos.timestamp,
              });
            } catch {
              // Swallow — next tick will retry, the server stays authoritative.
            }
          },
        );
      } catch {
        // Permission revoked between request and subscribe; nothing to do.
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [ride?.id, ride?.isOpen, ride?.status]);
}

export default function RidesScreen() {
  const router = useRouter();
  const { t } = useTranslation();
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
            setInbox([]);
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
  // While an open ride is in_progress we want the meter card to update
  // every ~3 s; otherwise the standard cadence is fine.
  const openMeterActive = current?.isOpen && current.status === 'in_progress';
  usePolling(load, openMeterActive ? 3_000 : (current ? 8_000 : 5_000));

  // Background-ish GPS pinger. Fires every 5 s while the active ride is an
  // open ride in_progress; pushes the sample to the API which trusts it
  // (after gating against teleports / bad accuracy) for the metered fare.
  useOpenRideMeterPinger(current);

  return (
    <Screen scroll onRefresh={load} refreshing={loading}>
      <ScreenHeader title={t('captain.rides.title')} onBack={() => router.back()} />
      {current ? (
        <CurrentRideCard ride={current} onChanged={load} />
      ) : (
        <InboxList items={inbox} onAccepted={load} />
      )}
    </Screen>
  );
}

function InboxList({ items, onAccepted }: { items: InboxItem[]; onAccepted: () => void }) {
  const { t } = useTranslation();
  const [accepting, setAccepting] = useState<string | null>(null);
  // Synchronous guard: blocks a 2nd tap that arrives before React re-renders
  // the disabled state. Without it, two near-simultaneous taps would fire two
  // requests and surface a spurious "already taken" alert.
  const pendingRef = useRef(false);

  async function accept(id: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setAccepting(id);
    try {
      await api.post(`/captain/rides/${id}/accept`);
      onAccepted();
    } catch (e: any) {
      const code = e.response?.data?.error?.code;
      if (code === 'not_searching') {
        Alert.alert(t('captainAlert.alreadyTakenTitle'), t('captainAlert.alreadyTaken'));
        onAccepted();
      } else {
        Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
      }
    } finally {
      setAccepting(null);
      pendingRef.current = false;
    }
  }

  return (
    <View>
      <AppText variant="h1">{t('captain.rides.nearbyTitle')}</AppText>
      <AppText variant="caption" color={colors.ink2} style={{ marginTop: spacing.xs }}>
        {t('captain.rides.nearbyHint')}
      </AppText>

      {items.length === 0 ? (
        <Card elevation="none" background={colors.surfaceAlt} padding={spacing.xxl}
          style={{ marginTop: spacing.lg, alignItems: 'center', gap: spacing.sm }}>
          <Icon name="clock" size={30} color={colors.muted} />
          <AppText variant="body" color={colors.muted}>{t('captain.rides.emptyInbox')}</AppText>
        </Card>
      ) : items.map((it) => {
        const accent = it.isFavorite ? colors.sun : (it.rideType === 'colis' ? colors.espresso : colors.ember);
        const isColis = it.rideType === 'colis';
        return (
          <Card key={it.id} padding={0} style={{ marginTop: spacing.md, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: 5, backgroundColor: accent }} />
              <View style={{ flex: 1, padding: spacing.base }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Chip icon={isColis ? 'parcel' : 'ride'} label={isColis ? t('captain.rides.colis') : t('captain.rides.passenger')}
                      bg={isColis ? colors.espresso : colors.emberSoft}
                      fg={isColis ? colors.saffron : colors.ember} />
                    {it.isFavorite ? <Chip icon="star" label={t('captain.rides.favorite')} bg={colors.saffronSoft} fg={colors.warning} /> : null}
                    {it.source === 'operator' ? <Chip icon="phone" label={t('captainAlert.callCenterBadge')} bg="#ede9fe" fg="#6d28d9" /> : null}
                    {it.isOpen ? <Chip icon="clock" label={t('captain.rides.openBadge')} bg="#dcfce7" fg="#166534" /> : null}
                    {it.homewardProgressM && it.homewardProgressM > 0
                      ? <Chip icon="home" label={t('captain.rides.getsCloser')} bg={colors.successSoft} fg={colors.success} /> : null}
                  </View>
                  <AppText variant="caption" color={colors.muted}>
                    {(it.distanceToPickupM / 1000).toFixed(1)} {t('common.kmShort')}
                  </AppText>
                </View>

                <Route
                  pickup={it.pickup.label}
                  dropoff={it.isOpen ? t('captain.rides.openDestinationShort') : (it.dropoff?.label ?? null)}
                  style={{ marginTop: spacing.md }}
                />

                <View style={{ marginTop: spacing.base, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="h2">
                    {it.isOpen
                      ? t('captain.rides.meterShort')
                      : (it.fareEstimateMru ? formatMru(it.fareEstimateMru) : '—')}
                  </AppText>
                  <Button
                    title={t('captain.rides.accept')}
                    size="md"
                    fullWidth={false}
                    icon="checkSmall"
                    busy={accepting === it.id}
                    disabled={accepting !== null && accepting !== it.id}
                    onPress={() => accept(it.id)}
                  />
                </View>
              </View>
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function CurrentRideCard({ ride, onChanged }: { ride: Ride; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try { await fn(); await onChanged(); }
    catch (e: any) {
      Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
    } finally { setBusy(null); }
  }

  function arrive() {
    return action('arrive', async () => {
      await api.post(`/captain/rides/${ride.id}/arrive`);
    });
  }

  function start() {
    if (!/^\d{4}$/.test(code)) {
      Alert.alert(t('captain.rides.codeRequiredTitle'), t('captain.rides.codeRequiredBody'));
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
        Alert.alert(t('captain.rides.deliveryCodeTitle'), t('captain.rides.deliveryCodeBody'));
        return;
      }
      body.dropOtp = code;
    }
    return action('complete', async () => {
      await api.post(`/captain/rides/${ride.id}/complete`, body);
      setCode('');
    });
  }

  async function cancel() {
    Alert.alert(
      t('captain.rides.cancelTitle'),
      t('captain.rides.cancelBody'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('common.cancel'), style: 'destructive',
          onPress: () => action('cancel', async () => {
            await api.post(`/captain/rides/${ride.id}/cancel`, { reason: 'captain_cancel' });
          }),
        },
      ],
    );
  }

  return (
    <View>
      <Card background={colors.espresso} elevation="raised" padding={spacing.xl}>
        <AppText variant="overline" color={colors.saffron}>
          {ride.status === 'accepted' || ride.status === 'arrived' || ride.status === 'in_progress'
            ? t(`captain.rides.stepLabel.${ride.status}` as const)
            : ride.status}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
          <Icon name={ride.rideType === 'colis' ? 'parcel' : 'person'} size={24} color={colors.onEspresso} />
          <AppText variant="h1" color={colors.onEspresso}>
            {ride.rideType === 'colis'
              ? t('captain.rides.colis')
              : (ride.rider?.fullName ?? ride.passengerName ?? t('captain.rides.passengerFallback'))}
          </AppText>
        </View>

        {(() => {
          const contactPhone = ride.rider?.phone ?? ride.passengerPhone;
          if (!contactPhone) return null;
          return (
            <View style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <AppText variant="body" color={colors.onEspressoMuted} style={{ flex: 1 }}>
                {contactPhone}{ride.isForOther ? ` · ${t('captain.rides.forOther')}` : ''}
              </AppText>
              <PressableScale
                onPress={() => Linking.openURL(`tel:${contactPhone}`)}
                style={{
                  backgroundColor: colors.ember, paddingHorizontal: 16, paddingVertical: 9,
                  borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6,
                }}
              >
                <Icon name="phone" size={16} color={colors.onEmber} />
                <AppText variant="label" color={colors.onEmber}>{t('captain.rides.callBtn')}</AppText>
              </PressableScale>
            </View>
          );
        })()}

        <Route
          pickup={ride.pickup.label}
          dropoff={ride.isOpen ? t('captain.rides.openDestinationShort') : (ride.dropoff?.label ?? null)}
          onDark
          style={{ marginTop: spacing.lg }}
        />

        <View style={{ marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <AppText variant="caption" color={colors.onEspressoMuted}>
              {ride.isOpen ? t('captain.rides.meterTariffLabel') : t('captain.rides.estimatedFare')}
            </AppText>
            <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: 2 }}>
              {ride.isOpen
                ? (ride.openTariff
                    ? `${ride.openTariff.perKmMru} / km · ${ride.openTariff.perMinuteMru} / min`
                    : '—')
                : (ride.fareEstimateMru ? formatMru(ride.fareEstimateMru) : '—')}
            </AppText>
          </View>
          <View>
            <AppText variant="caption" color={colors.onEspressoMuted}>{t('captain.rides.payment')}</AppText>
            <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: 2 }}>
              {ride.paymentMethod === 'cash' ? t('captain.rides.cash') : t('captain.rides.wallet')}
            </AppText>
          </View>
        </View>
      </Card>

      {ride.isOpen && ride.status === 'in_progress' ? (
        <CaptainMeterCard ride={ride} />
      ) : null}

      {ride.status === 'accepted' ? (
        <Button title={t('captain.rides.actionImArrived')} icon="pin" onPress={arrive} busy={busy === 'arrive'}
          style={{ marginTop: spacing.base }} />
      ) : null}

      {ride.status === 'arrived' ? (
        <CodeBox
          title={ride.rideType === 'colis' ? t('captain.rides.codeSenderTitle') : t('captain.rides.codePassengerTitle')}
          subtitle={ride.rideType === 'colis'
            ? t('captain.rides.codeSenderSub')
            : t('captain.rides.codePassengerSub')}
          code={code}
          onChange={setCode}
          actionLabel={ride.rideType === 'colis' ? t('captain.rides.startDelivery') : t('captain.rides.startRide')}
          onAction={start}
          busy={busy === 'start'}
        />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'passenger' ? (
        <Button
          title={ride.isOpen ? t('captain.rides.endOpenRide') : t('captain.rides.completeRide')}
          icon="check"
          onPress={complete}
          busy={busy === 'complete'}
          style={{ marginTop: spacing.base }}
        />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'colis' ? (
        <CodeBox
          title={t('captain.rides.deliveryConfirmTitle')}
          subtitle={t('captain.rides.deliveryConfirmSub')}
          code={code}
          onChange={setCode}
          actionLabel={t('captain.rides.confirmDelivery')}
          onAction={complete}
          busy={busy === 'complete'}
        />
      ) : null}

      <Button
        title={t('captain.rides.cancelRide')}
        variant="danger"
        onPress={cancel}
        style={{ marginTop: spacing.md }}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */

function Chip({ icon, label, bg, fg }: { icon: IconName; label: string; bg: string; fg: string }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill,
    }}>
      <Icon name={icon} size={13} color={fg} />
      <AppText variant="overline" color={fg} style={{ letterSpacing: 0.4 }}>{label}</AppText>
    </View>
  );
}

function Route({
  pickup, dropoff, onDark, style,
}: {
  pickup: string | null; dropoff: string | null; onDark?: boolean; style?: any;
}) {
  const { t } = useTranslation();
  const muted = onDark ? colors.onEspressoMuted : colors.muted;
  const strong = onDark ? colors.onEspresso : colors.ink;
  return (
    <View style={[{ flexDirection: 'row' }, style]}>
      <View style={{ alignItems: 'center', marginRight: spacing.md, paddingTop: 4 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ember }} />
        <View style={{ width: 2, flex: 1, minHeight: 18, backgroundColor: onDark ? colors.espressoAlt : colors.line, marginVertical: 3 }} />
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colors.sun }} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color={muted}>{t('common.from')}</AppText>
        <AppText variant="bodyStrong" color={strong} numberOfLines={1}>{pickup ?? t('captain.rides.pickupFallback')}</AppText>
        <AppText variant="caption" color={muted} style={{ marginTop: spacing.sm }}>{t('common.to')}</AppText>
        <AppText variant="bodyStrong" color={strong} numberOfLines={1}>{dropoff ?? t('captain.rides.dropoffFallback')}</AppText>
      </View>
    </View>
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
    <Card padding={spacing.base} style={{ marginTop: spacing.base }}>
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>{subtitle}</AppText>
      <TextInput
        value={code}
        onChangeText={(t) => onChange(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        placeholder="····"
        placeholderTextColor={colors.faint}
        style={{
          marginTop: spacing.md, borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md,
          paddingVertical: 16, fontSize: 26, color: colors.ink, backgroundColor: colors.sunken,
          textAlign: 'center', letterSpacing: 14, fontFamily: 'Sora_700Bold',
        }}
      />
      <Button title={actionLabel} onPress={onAction} busy={busy} style={{ marginTop: spacing.md }} />
    </Card>
  );
}

/**
 * Captain-side live meter. Mirrors what the rider sees, so the captain
 * knows exactly what the rider is being charged in real time and can stop
 * the trip when the rider asks. Numbers come from the API (the GPS pinger
 * already streams to the server) and refresh on the same polling tick.
 */
function CaptainMeterCard({ ride }: { ride: Ride }) {
  const { t } = useTranslation();
  const m = ride.liveMeter;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1.00, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const minutes = m ? Math.floor(m.durationS / 60) : 0;
  const seconds = m ? m.durationS % 60 : 0;
  const km = m ? (m.distanceM / 1000).toFixed(2) : '0.00';

  return (
    <Card padding={spacing.lg} style={{ marginTop: spacing.base, backgroundColor: '#0f172a' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10a35e' }} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#10a35e', letterSpacing: 0.6 }}>
          {t('captain.rides.openMeterLive').toUpperCase()}
        </Text>
      </View>
      <Animated.Text style={{
        fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: -1,
        marginTop: 10,
        transform: [{ scale: pulse }],
      }}>
        {formatMru(m?.fareMru ?? 0)}
      </Animated.Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 0.4 }}>
            {t('captain.rides.openMeterDistance').toUpperCase()}
          </Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 4 }}>
            {km} <Text style={{ fontSize: 11, color: '#94a3b8' }}>km</Text>
          </Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#1e293b', borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 0.4 }}>
            {t('captain.rides.openMeterDuration').toUpperCase()}
          </Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 4 }}>
            {minutes}:{String(seconds).padStart(2, '0')}
          </Text>
        </View>
      </View>
    </Card>
  );
}
