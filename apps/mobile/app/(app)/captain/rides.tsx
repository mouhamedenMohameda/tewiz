import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Linking, Pressable, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { RideCancelReasonSheet } from '@/components/RideCancelReasonSheet';
import { formatMru } from '@/lib/format';
import { CAPTAIN_RIDE_CANCEL_REASONS, RIDE_CANCEL_REASON_LABEL_FR } from '@/lib/rideCancelReasons';
import { usePolling } from '@/lib/usePolling';
import { keepIfEqual } from '@/lib/sameData';
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

type RideType = 'passenger' | 'colis' | 'private_driver' | 'convoyage';

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
  bookedDurationH?: number | null;
  vehiclePlate?: string | null;
  vehicleDescription?: string | null;
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
  distanceM: number | null;
  durationS: number | null;
  paymentMethod: 'cash' | 'wallet';
  isOpen: boolean;
  requestedAt: string;
  openTariff: {
    baseFareMru: number;
    perKmMru: number;
    perMinuteMru: number;
    minFareMru: number;
  } | null;
  liveMeter?: { distanceM: number; durationS: number; fareMru: number } | null;
  completedAt?: string | null;
  startedAt?: string | null;
  privateDriverDetails?: {
    bookedDurationH: number;
    hourlyRateMru: number;
    bookedFareMru: number;
  } | null;
  convoyageDetails?: {
    vehiclePlate: string;
    vehicleDescription: string;
  } | null;
}

/**
 * Captain-side GPS pinger for every active ride. While the captain has a
 * ride in_progress, watch position and POST every accepted sample to
 * `/captain/rides/:id/location`. The server rejects teleports / bad-accuracy
 * fixes — those are kept silent because the next sample will succeed.
 *
 * Throttles to one push every ~5 s on top of the OS-level distanceInterval.
 * For open rides this feeds the trusted meter. For closed rides this provides
 * anti-fraud telemetry so GPS tampering can be detected at completion.
 */
function useOpenRideMeterPinger(ride: Ride | null) {
  const lastPushRef = useRef(0);
  useEffect(() => {
    if (!ride || ride.status !== 'in_progress') return;

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
  const [history, setHistory] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [curRes, historyRes] = await Promise.all([
        api.get<Ride>('/captain/rides/current', {
          validateStatus: (s) => s === 200 || s === 204,
        }),
        api.get<Ride[]>('/captain/rides/history'),
      ]);
      // keepIfEqual bails out of the re-render when the polled data matches the
      // previous tick (the usual case at 3–8 s cadence between real changes).
      setHistory(keepIfEqual(historyRes.data));
      if (curRes.status === 204) {
        setCurrent(keepIfEqual<Ride | null>(null));
        try {
          const inb = await api.get<InboxItem[]>('/captain/rides/inbox');
          setInbox(keepIfEqual(inb.data));
        } catch (e: any) {
          if (e.response?.status === 400) {
            setInbox(keepIfEqual<InboxItem[]>([]));
          } else {
            throw e;
          }
        }
      } else {
        setCurrent(keepIfEqual<Ride | null>(curRes.data));
        setInbox(keepIfEqual<InboxItem[]>([]));
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
      <HistorySection items={history} />
    </Screen>
  );
}

function HistorySection({ items }: { items: Ride[] }) {
  const { t, i18n } = useTranslation();
  const completedOpen = items.find((it) => it.status === 'completed' && it.isOpen);
  const others = completedOpen ? items.filter((it) => it.id !== completedOpen.id) : items;
  const recent = others.slice(0, completedOpen ? 6 : 7);

  return (
    <View style={{ marginTop: spacing.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <AppText variant="h1">{t('captain.rides.historyTitle')}</AppText>
          <AppText variant="caption" color={colors.ink2} style={{ marginTop: spacing.xs }}>
            {t('captain.rides.historyHint')}
          </AppText>
        </View>
        {recent.length > 0 ? (
          <View style={{
            borderRadius: radius.pill,
            backgroundColor: colors.surfaceAlt,
            paddingHorizontal: spacing.sm,
            paddingVertical: 6,
          }}>
            <AppText variant="overline" color={colors.ink2}>{recent.length}</AppText>
          </View>
        ) : null}
      </View>

      {completedOpen ? (
        <AnimatedEntry index={0}>
          <Card
            padding={0}
            style={{
              marginTop: spacing.base,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: '#f0dfb2',
            }}
          >
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: 5, backgroundColor: colors.warning }} />
              <View style={{ flex: 1, padding: spacing.lg }}>
                <AppText variant="overline" color={colors.warning}>
                  {t('captain.rides.lastCompletedOpenRide')}
                </AppText>
                <View style={{ marginTop: spacing.xs, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.base }}>
                  <View style={{ flex: 1 }}>
                    <AppText variant="h2" numberOfLines={1}>
                      {completedOpen.rider?.fullName ?? completedOpen.passengerName ?? t('captain.rides.passengerFallback')}
                    </AppText>
                    <AppText variant="caption" color={colors.ink2} style={{ marginTop: 4 }} numberOfLines={1}>
                      {completedOpen.pickup.label ?? t('captain.rides.pickupFallback')} → {completedOpen.dropoff?.label ?? t('captain.rides.openDestinationShort')}
                    </AppText>
                  </View>
                  <View style={{
                    backgroundColor: '#fff6dd',
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: '#f0dfb2',
                    paddingHorizontal: spacing.sm,
                    paddingVertical: spacing.xs,
                  }}>
                    <AppText variant="overline" color={colors.warning}>{t('captain.rides.amountToCollect')}</AppText>
                    <AppText variant="bodyStrong" style={{ marginTop: 2 }}>
                      {formatMru(completedOpen.fareFinalMru ?? completedOpen.fareEstimateMru ?? 0)}
                    </AppText>
                  </View>
                </View>

                <AppText variant="overline" color={colors.ink2} style={{ marginTop: spacing.base }}>
                  {t('captain.rides.detailsTitle')}
                </AppText>
                <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
                  <HistoryMetricTile label={t('captain.rides.passengerPhone')} value={completedOpen.rider?.phone ?? completedOpen.passengerPhone ?? '—'} />
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <HistoryMetricTile label={t('captain.rides.completedAt')} value={fmtDate(completedOpen.completedAt ?? completedOpen.requestedAt, i18n.language)} flex={1} />
                    <HistoryMetricTile label={t('captain.rides.grossAmount')} value={formatMru(rideAmount(completedOpen))} flex={1} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <HistoryMetricTile label={t('captain.rides.commissionAmount')} value={formatMru(completedOpen.commissionMru ?? 0)} flex={1} />
                    <HistoryMetricTile label={t('captain.rides.netEarning')} value={formatMru(rideNet(completedOpen))} flex={1} />
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <HistoryMetricTile
                      label={t('captain.rides.distance')}
                      value={completedOpen.distanceM != null ? `${(completedOpen.distanceM / 1000).toFixed(1)} ${t('common.kmShort')}` : '—'}
                      flex={1}
                    />
                    <HistoryMetricTile
                      label={t('captain.rides.duration')}
                      value={completedOpen.durationS != null ? formatRideDuration(completedOpen.durationS) : '—'}
                      flex={1}
                    />
                  </View>
                </View>
              </View>
            </View>
          </Card>
        </AnimatedEntry>
      ) : null}

      {recent.length > 0 ? (
        <View style={{ marginTop: spacing.base, gap: spacing.sm }}>
          {recent.map((item, index) => (
            <AnimatedEntry key={item.id} index={index + 1}>
              <Card
                padding={0}
                style={{
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: '#eef1f5',
                }}
              >
                <View style={{ flexDirection: 'row' }}>
                  <View style={{ width: 4, backgroundColor: item.paymentMethod === 'cash' ? colors.success : colors.ember }} />
                  <View style={{ flex: 1, padding: spacing.base }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.base }}>
                      <View style={{ flex: 1 }}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {item.rider?.fullName ?? item.passengerName ?? t('captain.rides.passengerFallback')}
                        </AppText>
                        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }} numberOfLines={1}>
                          {item.pickup.label ?? t('captain.rides.pickupFallback')} · {item.dropoff?.label ?? t('captain.rides.dropoffFallback')}
                        </AppText>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <AppText variant="bodyStrong">
                          {formatMru(rideAmount(item))}
                        </AppText>
                        <AppText variant="caption" color={colors.ink2} style={{ marginTop: 2 }}>
                          {fmtDate(item.completedAt ?? item.requestedAt, i18n.language)}
                        </AppText>
                      </View>
                    </View>

                    <View style={{ marginTop: spacing.base, gap: spacing.sm }}>
                      <AppText variant="overline" color={colors.ink2}>{t('captain.rides.detailsTitle')}</AppText>
                      <HistoryMetricTile label={t('captain.rides.passengerPhone')} value={item.rider?.phone ?? item.passengerPhone ?? '—'} />
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <HistoryMetricTile
                          label={t('captain.rides.grossAmount')}
                          value={formatMru(rideAmount(item))}
                          flex={1}
                        />
                        <HistoryMetricTile
                          label={t('captain.rides.commissionAmount')}
                          value={formatMru(item.commissionMru ?? 0)}
                          flex={1}
                        />
                      </View>
                      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <HistoryMetricTile
                          label={t('captain.rides.netEarning')}
                          value={formatMru(rideNet(item))}
                          flex={1}
                        />
                        <HistoryMetricTile
                          label={t('captain.rides.distance')}
                          value={item.distanceM != null ? `${(item.distanceM / 1000).toFixed(1)} ${t('common.kmShort')}` : '—'}
                          flex={1}
                        />
                      </View>
                      <HistoryMetricTile
                        label={t('captain.rides.duration')}
                        value={item.durationS != null ? formatRideDuration(item.durationS) : '—'}
                      />
                    </View>
                  </View>
                </View>
              </Card>
            </AnimatedEntry>
          ))}
        </View>
      ) : (
        <Card background={colors.surfaceAlt} padding={spacing.lg} style={{ marginTop: spacing.base }}>
          <AppText variant="body" color={colors.muted}>{t('captain.rides.historyEmpty')}</AppText>
        </Card>
      )}
    </View>
  );
}

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleString(locale, {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRideDuration(seconds: number) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function rideAmount(ride: Ride) {
  return ride.fareFinalMru ?? ride.fareEstimateMru ?? 0;
}

function rideNet(ride: Ride) {
  return Math.max(0, rideAmount(ride) - (ride.commissionMru ?? 0));
}

function AnimatedEntry({ index = 0, children }: { index?: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 220,
        delay: index * 70,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 240,
        delay: index * 70,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function HistoryMetricTile({
  label, value, flex,
}: {
  label: string;
  value: string;
  flex?: number;
}) {
  return (
    <View style={{
      flex: flex ?? undefined,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    }}>
      <AppText variant="caption" color={colors.ink2}>{label}</AppText>
      <AppText variant="bodyStrong" style={{ marginTop: 2 }} numberOfLines={1}>
        {value}
      </AppText>
    </View>
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
        const accent = it.isFavorite ? colors.sun : (it.rideType === 'colis' ? colors.espresso : it.rideType === 'private_driver' ? '#1e40af' : it.rideType === 'convoyage' ? '#7c3aed' : colors.ember);
        const isColis = it.rideType === 'colis';
        return (
          <Card key={it.id} padding={0} style={{ marginTop: spacing.md, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ width: 5, backgroundColor: accent }} />
              <View style={{ flex: 1, padding: spacing.base }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Chip icon={isColis ? 'parcel' : it.rideType === 'private_driver' ? 'clock' : it.rideType === 'convoyage' ? 'ride' : 'ride'}
                      label={isColis ? t('captain.rides.colis') : it.rideType === 'private_driver' ? `Chauffeur · ${it.bookedDurationH}h` : it.rideType === 'convoyage' ? `Convoyage${it.vehiclePlate ? ` · ${it.vehiclePlate}` : ''}` : t('captain.rides.passenger')}
                      bg={isColis ? colors.espresso : it.rideType === 'private_driver' ? '#dbeafe' : it.rideType === 'convoyage' ? '#ede9fe' : colors.emberSoft}
                      fg={isColis ? colors.saffron : it.rideType === 'private_driver' ? '#1e40af' : it.rideType === 'convoyage' ? '#7c3aed' : colors.ember} />
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
                  dropoff={it.rideType === 'private_driver' ? 'Pas de destination fixe' : it.isOpen ? t('captain.rides.openDestinationShort') : (it.dropoff?.label ?? null)}
                  style={{ marginTop: spacing.md }}
                />

                <View style={{ marginTop: spacing.base, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText variant="h2">
                    {it.rideType === 'private_driver'
                      ? `${formatMru(it.fareEstimateMru ?? 0)} · ${it.bookedDurationH}h`
                      : it.isOpen
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
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);

  function errorMessage(e: any) {
    return (
      e?.response?.data?.error?.message
      ?? e?.response?.data?.message
      ?? e?.message
      ?? t('errors.generic')
    );
  }

  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    let transitionOk = false;
    try {
      await fn();
      transitionOk = true;
    } catch (e: any) {
      Alert.alert(t('common.impossible'), errorMessage(e));
    } finally {
      if (transitionOk) {
        try {
          await onChanged();
        } catch {
          // The state transition already succeeded server-side. If the
          // follow-up refresh fails (network hiccup), avoid showing a
          // misleading blocking error to the captain.
        }
      }
      setBusy(null);
    }
  }

  function arrive() {
    return action('arrive', async () => {
      await api.post(`/captain/rides/${ride.id}/arrive`);
    });
  }

  function start() {
    return action('start', async () => {
      await api.post(`/captain/rides/${ride.id}/start`);
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
      const res = await api.post<{
        gpsCompliance?: {
          offenseNumber: number;
          action: 'warning_1' | 'warning_2' | 'double_commission' | 'recovery_suspend';
          recoveryDebitMru: number;
          suspended: boolean;
        } | null;
      }>(`/captain/rides/${ride.id}/complete`, body);
      const gps = res.data?.gpsCompliance;
      if (gps) {
        if (gps.action === 'warning_1' || gps.action === 'warning_2') {
          Alert.alert(
            'Avertissement GPS',
            `Telemetrie GPS insuffisante detectee. Avertissement ${gps.offenseNumber}/2. Gardez le GPS actif pendant toute la course.`,
          );
        } else if (gps.action === 'double_commission') {
          Alert.alert(
            'Penalite GPS',
            'Telemetrie GPS insuffisante: la commission de cette course a ete doublee.',
          );
        } else if (gps.action === 'recovery_suspend') {
          Alert.alert(
            'Compte suspendu',
            `Recidive GPS detectee. Votre compte chauffeur a ete suspendu.${gps.recoveryDebitMru > 0 ? ` Recuperation appliquee: ${formatMru(gps.recoveryDebitMru)}.` : ''}`,
          );
        }
      }
      setCode('');
    });
  }

  async function cancel(reasonKey: string) {
    await action('cancel', async () => {
      await api.post(`/captain/rides/${ride.id}/cancel`, { reasonKey });
      setCancelSheetVisible(false);
    });
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
          <Icon name={ride.rideType === 'colis' ? 'parcel' : ride.rideType === 'private_driver' ? 'clock' : 'person'} size={24} color={colors.onEspresso} />
          <AppText variant="h1" color={colors.onEspresso}>
            {ride.rideType === 'colis'
              ? t('captain.rides.colis')
              : ride.rideType === 'private_driver'
                ? `Chauffeur Privé · ${ride.privateDriverDetails?.bookedDurationH ?? '?'}h`
                : ride.rideType === 'convoyage'
                  ? 'Convoyage'
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

        {ride.rideType === 'convoyage' && ride.convoyageDetails ? (
          <View style={{ marginTop: spacing.md, backgroundColor: '#1e293b', borderRadius: 8, padding: spacing.sm }}>
            <AppText variant="overline" color="#94a3b8">VÉHICULE À CONVOYER</AppText>
            <AppText variant="bodyStrong" color={colors.onEspresso} style={{ marginTop: 2 }}>
              {ride.convoyageDetails.vehiclePlate}
              {ride.convoyageDetails.vehicleDescription ? ` — ${ride.convoyageDetails.vehicleDescription}` : ''}
            </AppText>
          </View>
        ) : null}

        <Route
          pickup={ride.pickup.label}
          dropoff={ride.rideType === 'private_driver' ? 'Pas de destination fixe' : ride.isOpen ? t('captain.rides.openDestinationShort') : (ride.dropoff?.label ?? null)}
          onDark
          style={{ marginTop: spacing.lg }}
        />

        <View style={{ marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <AppText variant="caption" color={colors.onEspressoMuted}>
              {ride.rideType === 'private_driver' ? 'Tarif réservé' : ride.isOpen ? t('captain.rides.meterTariffLabel') : t('captain.rides.estimatedFare')}
            </AppText>
            <AppText variant="h2" color={colors.onEspresso} style={{ marginTop: 2 }}>
              {ride.rideType === 'private_driver'
                ? formatMru(ride.privateDriverDetails?.bookedFareMru ?? ride.fareEstimateMru ?? 0)
                : ride.isOpen
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

      {ride.rideType === 'private_driver' && ride.status === 'in_progress' ? (
        <CaptainPrivateDriverCard ride={ride} />
      ) : null}

      {ride.status === 'accepted' ? (
        <Button title={t('captain.rides.actionImArrived')} icon="pin" onPress={arrive} busy={busy === 'arrive'}
          style={{ marginTop: spacing.base }} />
      ) : null}

      {ride.status === 'arrived' ? (
        <Button
          title={ride.rideType === 'colis' ? t('captain.rides.startDelivery') : t('captain.rides.startRide')}
          icon="check"
          onPress={start}
          busy={busy === 'start'}
          style={{ marginTop: spacing.base }}
        />
      ) : null}

      {ride.status === 'in_progress' && ride.rideType === 'private_driver' ? (
        <Button
          title="Terminer la prestation"
          icon="check"
          onPress={complete}
          busy={busy === 'complete'}
          style={{ marginTop: spacing.base }}
        />
      ) : null}

      {ride.status === 'in_progress' && (ride.rideType === 'passenger' || ride.rideType === 'convoyage') ? (
        <Button
          title={ride.rideType === 'convoyage' ? 'Véhicule livré' : ride.isOpen ? t('captain.rides.endOpenRide') : t('captain.rides.completeRide')}
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
        onPress={() => setCancelSheetVisible(true)}
        style={{ marginTop: spacing.md }}
      />

      <RideCancelReasonSheet
        visible={cancelSheetVisible}
        title={t('captain.rides.cancelTitle')}
        body={t('captain.rides.cancelBody')}
        busy={busy === 'cancel'}
        options={CAPTAIN_RIDE_CANCEL_REASONS.map((key) => ({ key, label: RIDE_CANCEL_REASON_LABEL_FR[key] }))}
        onClose={() => { if (busy !== 'cancel') setCancelSheetVisible(false); }}
        onSelect={cancel}
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

function CaptainPrivateDriverCard({ ride }: { ride: Ride }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const pd = ride.privateDriverDetails;
  if (!pd || !ride.startedAt) return null;

  const elapsedS = Math.max(0, Math.floor((now - new Date(ride.startedAt).getTime()) / 1000));
  const bookedS = pd.bookedDurationH * 3600;
  const remainingS = bookedS - elapsedS;
  const isOvertime = remainingS <= 0;

  const absRemaining = Math.abs(remainingS);
  const h = Math.floor(absRemaining / 3600);
  const m = Math.floor((absRemaining % 3600) / 60);
  const s = absRemaining % 60;
  const timeStr = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  const elapsedH = Math.floor(elapsedS / 3600);
  const elapsedM = Math.floor((elapsedS % 3600) / 60);

  return (
    <Card padding={spacing.lg} style={{ marginTop: spacing.base, backgroundColor: isOvertime ? '#450a0a' : '#0f172a' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isOvertime ? '#ef4444' : '#10a35e' }} />
        <Text style={{ fontSize: 11, fontWeight: '700', color: isOvertime ? '#ef4444' : '#10a35e', letterSpacing: 0.6 }}>
          {isOvertime ? 'DÉPASSEMENT' : 'CHAUFFEUR PRIVÉ EN COURS'}
        </Text>
      </View>
      <Text style={{
        fontSize: 36, fontWeight: '800', color: '#fff', letterSpacing: -1, marginTop: 10,
      }}>
        {isOvertime ? '+' : ''}{timeStr}
      </Text>
      <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
        {isOvertime ? 'Temps dépassé' : 'Temps restant'}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1, backgroundColor: isOvertime ? '#7f1d1d' : '#1e293b', borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 0.4 }}>DURÉE RÉSERVÉE</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 4 }}>
            {pd.bookedDurationH}h
          </Text>
        </View>
        <View style={{ flex: 1, backgroundColor: isOvertime ? '#7f1d1d' : '#1e293b', borderRadius: 10, padding: 12 }}>
          <Text style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 0.4 }}>TEMPS ÉCOULÉ</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 4 }}>
            {elapsedH}h{String(elapsedM).padStart(2, '0')}
          </Text>
        </View>
      </View>
      <View style={{ backgroundColor: isOvertime ? '#7f1d1d' : '#1e293b', borderRadius: 10, padding: 12, marginTop: 10 }}>
        <Text style={{ fontSize: 10, color: '#94a3b8', letterSpacing: 0.4 }}>TARIF</Text>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 4 }}>
          {formatMru(pd.bookedFareMru)}
        </Text>
      </View>
    </Card>
  );
}
