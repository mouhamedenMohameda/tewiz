/**
 * "Where is my driver" — the screen the rider actually opens the app for.
 *
 * Shape: FULL-SCREEN MAP with a draggable bottom sheet over it, the layout
 * every rider already knows from every other ride-hailing app. It replaces a
 * plain scrolling page that showed the map as a 220 pt card wedged between
 * two others — which buried the one thing the screen exists to answer under
 * everything else it happened to know.
 *
 * The map is only mounted for statuses where there is something live to show
 * (see MAP_STATUSES). Once a ride reaches a terminal state the map is gone
 * entirely — that is a privacy rule, not a layout choice, see RideMap.
 *
 * Two honesty rules inherited from the server, unchanged from the previous
 * version and easy to break by accident:
 *   - `captain.location` is null rather than stale. When the server has
 *     nothing fresh we say "position indisponible" instead of drawing a car in
 *     the wrong street.
 *   - nothing is drawn once the ride is over, so a completed trip stops
 *     exposing a captain's whereabouts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Linking,
  Pressable, ScrollView, TextInput, useWindowDimensions, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Button, Icon, PressableScale, Screen, Sheet, type IconName } from '@/components/ui';
import { colors, fonts, radius, schemed, shadow, spacing } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { api } from '@/lib/api';
import { RideCancelReasonSheet } from '@/components/RideCancelReasonSheet';
import { BottomSheet } from '@/components/BottomSheet';
import { formatMru } from '@/lib/format';
import { RIDER_RIDE_CANCEL_REASONS } from '@/lib/rideCancelReasons';
import { usePolling } from '@/lib/usePolling';
import { keepIfEqual } from '@/lib/sameData';
import { APP_NAME } from '@/lib/brand';
import { MapShell } from '@/components/MapShell';
import { getMapbox } from '@/lib/mapbox';

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
  /**
   * Live position, or null when the server has nothing fresh enough to draw.
   * Deliberately null rather than stale: a car drawn where it was ten minutes
   * ago sends the rider to the wrong corner.
   */
  location: { lat: number; lng: number; updatedAt: string } | null;
}

interface Ride {
  id: string;
  status: RideStatus;
  rideType: 'passenger' | 'colis' | 'private_driver' | 'convoyage';
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null } | null;
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  paymentMethod: 'cash' | 'wallet';
  captain: Captain | null;
  /** Crow-flies metres between the captain and the pickup, when known. */
  captainDistanceM: number | null;
  privateDriverDetails: {
    bookedDurationH: number;
    hourlyRateMru: number;
    bookedFareMru: number;
  } | null;
  convoyageDetails: {
    vehiclePlate: string;
    vehicleDescription: string;
  } | null;
  startedAt: string | null;
  // Open ride / metered fare.
  isOpen: boolean;
  openTariff: {
    baseFareMru: number;
    perKmMru: number;
    perMinuteMru: number;
    minFareMru: number;
  } | null;
  /** Server-computed meter while status='in_progress'. */
  liveMeter: {
    distanceM: number;
    durationS: number;
    fareMru: number;
  } | null;
}

/**
 * Status → the design-system tone its headline wears. Replaces a hardcoded
 * slate/blue/indigo palette that predated the "Sahara Solaire" theme and made
 * this screen look like it belonged to a different app.
 */
// schemed(): a bare object literal here would freeze whichever
// palette was active when this module was first imported, and then
// never follow the user into dark mode.
const STATUS_TONE = schemed((): Record<RideStatus, { tint: string; fg: string; icon: IconName }> => ({
  pending_passenger_confirm: { tint: colors.saffronSoft, fg: colors.warning, icon: 'clock' },
  searching:                 { tint: colors.emberSoft,   fg: colors.ember,   icon: 'search' },
  accepted:                  { tint: colors.emberSoft,   fg: colors.ember,   icon: 'ride' },
  arrived:                   { tint: colors.successSoft, fg: colors.success, icon: 'pin' },
  in_progress:               { tint: colors.successSoft, fg: colors.success, icon: 'ride' },
  completed:                 { tint: colors.successSoft, fg: colors.success, icon: 'check' },
  cancelled_by_rider:        { tint: colors.dangerSoft,  fg: colors.danger,  icon: 'close' },
  cancelled_by_captain:      { tint: colors.dangerSoft,  fg: colors.danger,  icon: 'close' },
  cancelled_by_system:       { tint: colors.dangerSoft,  fg: colors.danger,  icon: 'close' },
  no_show:                   { tint: colors.dangerSoft,  fg: colors.danger,  icon: 'alert' },
}));

/** Statuses during which there is a live captain to draw. */
const LIVE_STATUSES: RideStatus[] = ['accepted', 'arrived', 'in_progress'];

/**
 * Statuses that get the full-screen map treatment. `searching` is included
 * even though no captain exists yet: the pickup pin alone still answers "did
 * it understand where I am", which is the anxious question while you wait.
 * Terminal statuses are deliberately absent — see RideMap.
 */
const MAP_STATUSES: RideStatus[] = [...LIVE_STATUSES, 'searching', 'pending_passenger_confirm'];

export default function CurrentRideScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);

  const goToRiderHome = useCallback(() => {
    router.replace('/(app)/rider');
  }, [router]);

  const load = useCallback(async () => {
    try {
      const r = await api.get<Ride>('/rider/rides/current', {
        validateStatus: (s) => s === 200 || s === 204,
      });
      // Bail out of the re-render when the polled ride is unchanged (the usual
      // case between real status changes) — see keepIfEqual.
      setRide(keepIfEqual(r.status === 200 ? r.data : null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Open rides display a live meter; poll fast enough that the number feels
  // alive (3 s) while in_progress, otherwise fall back to the standard 5 s.
  const liveMeterActive = (ride?.isOpen || ride?.rideType === 'private_driver') && ride?.status === 'in_progress';
  usePolling(load, liveMeterActive ? 3_000 : 5_000);

  async function cancel(reasonKey: string) {
    if (!ride) return;
    // Open ride after captain accepted: the captain is the only one who can
    // end the trip (rider is in the car, meter is running). Showing the
    // cancel button at all would mislead the user, so we silently skip.
    if ((ride.isOpen || ride.rideType === 'private_driver') && ride.status !== 'searching') return;
    setCancelling(true);
    try {
      await api.post(`/rider/rides/${ride.id}/cancel`, { reasonKey });
      setCancelSheetVisible(false);
      goToRiderHome();
    } catch (e: any) {
      Alert.alert(t('common.impossible'), e.response?.data?.error?.message ?? t('errors.generic'));
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.ember} />
        </View>
      </Screen>
    );
  }

  if (!ride) {
    return (
      <Screen>
        <BackButton onPress={goToRiderHome} inline />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm }}>
          <View style={{
            width: 64, height: 64, borderRadius: radius.lg, marginBottom: spacing.sm,
            backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="ride" size={32} color={colors.ember} />
          </View>
          <AppText variant="h2" align="center">{t('rider.current.noneTitle')}</AppText>
          <AppText variant="body" color={colors.ink2} align="center">
            {t('rider.current.noneSub')}
          </AppText>
          <Button
            title={t('rider.current.order')}
            icon="ride"
            fullWidth={false}
            style={{ marginTop: spacing.lg }}
            onPress={() => router.replace('/(app)/rider/new-ride')}
          />
        </View>
      </Screen>
    );
  }

  const isActive = ride.status === 'searching'
    || ride.status === 'accepted'
    || ride.status === 'arrived'
    || ride.status === 'in_progress';
  // Open ride past 'searching' → only the captain can end. Hide the rider
  // cancel button entirely to avoid a "cancel" that returns 403.
  const canRiderCancel = isActive && !((ride.isOpen || ride.rideType === 'private_driver') && ride.status !== 'searching');

  const needsRating = ride.status === 'completed' && !!ride.captain;

  const sheets = (
    <>
      <RideCancelReasonSheet
        visible={cancelSheetVisible}
        title={t('rider.current.cancelTitle')}
        body={t('rider.current.cancelBody')}
        busy={cancelling}
        options={RIDER_RIDE_CANCEL_REASONS.map((key) => ({ key, label: t(`rideCancelReasons.${key}`) }))}
        onClose={() => { if (!cancelling) setCancelSheetVisible(false); }}
        onSelect={cancel}
      />
      <RatingSheet
        visible={needsRating}
        ride={ride}
        onDone={async () => { await load(); router.replace('/(app)/rider'); }}
      />
    </>
  );

  const details = (
    <RideDetails
      ride={ride}
      cancelling={cancelling}
      canRiderCancel={canRiderCancel}
      onCancelPress={() => setCancelSheetVisible(true)}
    />
  );

  // Terminal states (completed, cancelled, no-show) have no map and nothing
  // live to watch, so a sheet over an empty canvas would be theatre. They get
  // an ordinary scrolling page instead.
  if (!MAP_STATUSES.includes(ride.status)) {
    return (
      <Screen scroll onRefresh={load}>
        <BackButton onPress={goToRiderHome} inline />
        <StatusHeadline status={ride.status} distanceM={null} />
        {details}
        {sheets}
      </Screen>
    );
  }

  return (
    <MapScene
      ride={ride}
      onBack={goToRiderHome}
      details={details}
      sheets={sheets}
    />
  );
}

/* ------------------------------------------------------------------ *
 *  The map + sheet composition
 * ------------------------------------------------------------------ */

function MapScene({
  ride, onBack, details, sheets,
}: {
  ride: Ride;
  onBack: () => void;
  details: React.ReactNode;
  sheets: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  // Collapsed shows the status line and the captain row — the two things worth
  // glancing at without touching anything. Expanded stops well short of the
  // top so the map never fully disappears: the sheet is a companion to the
  // map, not a replacement for it.
  const collapsedHeight = Math.round(Math.min(height * 0.34, 280));
  const expandedHeight = Math.round(Math.min(height * 0.72, 620));

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <RideMap ride={ride} insets={insets} />

      <View style={{ position: 'absolute', top: insets.top + spacing.sm, left: spacing.base }}>
        <BackButton onPress={onBack} />
      </View>

      <BottomSheet expandedHeight={expandedHeight} collapsedHeight={collapsedHeight}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing.xl,
          }}
        >
          <StatusHeadline status={ride.status} distanceM={ride.captainDistanceM} />
          {details}
        </ScrollView>
      </BottomSheet>

      {sheets}
    </View>
  );
}

/**
 * Everything under the status headline, shared by the map layout (inside the
 * sheet) and the terminal-state layout (inline on the page).
 */
function RideDetails({
  ride, cancelling, canRiderCancel, onCancelPress,
}: {
  ride: Ride;
  cancelling: boolean;
  canRiderCancel: boolean;
  onCancelPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {ride.captain ? <CaptainCard captain={ride.captain} /> : null}

      {ride.isOpen && ride.status === 'in_progress' ? (
        <LiveMeterCard ride={ride} />
      ) : null}

      {ride.rideType === 'private_driver' && ride.status === 'in_progress' && ride.privateDriverDetails && ride.startedAt ? (
        <PrivateDriverTimerCard
          startedAt={ride.startedAt}
          bookedDurationH={ride.privateDriverDetails.bookedDurationH}
          bookedFareMru={ride.privateDriverDetails.bookedFareMru}
        />
      ) : null}

      <TripCard ride={ride} />

      {canRiderCancel ? (
        <Button
          title={cancelling ? t('rider.current.cancelling') : t('rider.current.cancelAction')}
          variant="danger"
          size="md"
          icon="close"
          disabled={cancelling}
          style={{ marginTop: spacing.lg }}
          onPress={onCancelPress}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Map
 * ------------------------------------------------------------------ */

/**
 * The live map, full-bleed behind the sheet.
 *
 * The camera actively follows what matters at each stage — both car and pickup
 * while the captain approaches, both car and destination once you're moving.
 * The old version set the camera once via `defaultSettings` and never touched
 * it again, so the captain marker simply drifted off the edge as they drove.
 *
 * Mapbox's logo and attribution are pinned to the TOP of the map. Their
 * default home is the bottom corner, which the sheet covers — and their terms
 * require both to stay visible. Top placement is the only spot that survives
 * the sheet being dragged to any height.
 */
function RideMap({ ride, insets }: { ride: Ride; insets: { top: number } }) {
  const { t } = useTranslation();
  const M = getMapbox();
  const cameraRef = useRef<any>(null);
  // Gates the camera effect until <Camera> exists — see MapShell's onReady.
  const [cameraReady, setCameraReady] = useState(false);

  const captainAt = LIVE_STATUSES.includes(ride.status) ? ride.captain?.location ?? null : null;
  // While in progress the interesting pair is car → destination; before
  // pickup it is car → pickup.
  const focusTarget = ride.status === 'in_progress' && ride.dropoff
    ? { lat: ride.dropoff.lat, lng: ride.dropoff.lng }
    : { lat: ride.pickup.lat, lng: ride.pickup.lng };

  // Round the coordinates the effect depends on, so a GPS jitter of a few
  // centimetres doesn't re-run a 700 ms camera animation every poll.
  const camKey = [
    captainAt ? captainAt.lat.toFixed(4) : '',
    captainAt ? captainAt.lng.toFixed(4) : '',
    focusTarget.lat.toFixed(4),
    focusTarget.lng.toFixed(4),
  ].join(',');

  useEffect(() => {
    const cam = cameraRef.current;
    if (!cameraReady || !cam) return;

    if (!captainAt) {
      cam.setCamera({
        centerCoordinate: [focusTarget.lng, focusTarget.lat],
        zoomLevel: 14,
        animationDuration: 600,
      });
      return;
    }

    const lats = [captainAt.lat, focusTarget.lat];
    const lngs = [captainAt.lng, focusTarget.lng];
    // Degenerate bounds (captain effectively on top of the target) make
    // fitBounds zoom to a meaningless level — centre instead.
    const spread = Math.max(
      Math.abs(lats[0]! - lats[1]!),
      Math.abs(lngs[0]! - lngs[1]!),
    );
    if (spread < 0.0008) {
      cam.setCamera({
        centerCoordinate: [captainAt.lng, captainAt.lat],
        zoomLevel: 15.5,
        animationDuration: 600,
      });
      return;
    }

    cam.fitBounds(
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.min(...lats)],
      // Bottom padding clears the collapsed sheet so neither point hides
      // behind it; top clears the back button and the Mapbox ornaments.
      [140, 60, 60, 60],
      700,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camKey, cameraReady]);

  if (!M) return <View style={{ flex: 1, backgroundColor: colors.canvasDeep }} />;

  const ornamentTop = insets.top + 60;

  return (
    <View style={{ flex: 1 }}>
      <MapShell
        cameraRef={cameraRef}
        onReady={() => setCameraReady(true)}
        centerCoordinate={[focusTarget.lng, focusTarget.lat]}
        zoomLevel={14}
        logoPosition={{ top: ornamentTop, left: spacing.md }}
        attributionPosition={{ top: ornamentTop, left: 110 }}
      >
        <M.PointAnnotation id="pickup" coordinate={[ride.pickup.lng, ride.pickup.lat]}>
          <View style={{
            width: 18, height: 18, borderRadius: 9,
            backgroundColor: colors.success, borderWidth: 3, borderColor: colors.white,
            ...shadow.card,
          }} />
        </M.PointAnnotation>

        {ride.dropoff ? (
          <M.PointAnnotation id="dropoff" coordinate={[ride.dropoff.lng, ride.dropoff.lat]}>
            <View style={{
              width: 16, height: 16, borderRadius: 4,
              backgroundColor: colors.ink, borderWidth: 3, borderColor: colors.white,
              ...shadow.card,
            }} />
          </M.PointAnnotation>
        ) : null}

        {captainAt ? (
          <M.PointAnnotation id="captain" coordinate={[captainAt.lng, captainAt.lat]}>
            {/* Exactly ONE subview — rnmapbox logs an error above that. */}
            <View style={{
              width: 38, height: 38, borderRadius: 19,
              backgroundColor: colors.ember, borderWidth: 3, borderColor: colors.white,
              alignItems: 'center', justifyContent: 'center',
              ...shadow.ember,
            }}>
              <Icon name="ride" size={20} color={colors.white} />
            </View>
          </M.PointAnnotation>
        ) : null}
      </MapShell>

      {/* Position honesty pill — says outright when the server has nothing
          fresh, rather than letting an empty map imply "no driver". */}
      {LIVE_STATUSES.includes(ride.status) && !captainAt ? (
        <View style={{
          position: 'absolute', top: insets.top + 60, alignSelf: 'center',
          backgroundColor: colors.espresso, paddingHorizontal: spacing.md, paddingVertical: 7,
          borderRadius: radius.pill, ...shadow.raised,
        }}>
          <AppText variant="caption" color={colors.onEspresso}>
            {t('rider.current.map.positionUnavailable')}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ *
 *  Sheet content
 * ------------------------------------------------------------------ */

/**
 * The headline: what is happening, and — the question everyone actually has —
 * how far away the car is.
 */
function StatusHeadline({ status, distanceM }: { status: RideStatus; distanceM: number | null }) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[status] ?? STATUS_TONE.searching;
  const title = t(`rider.current.banners.${status}.title`, {
    defaultValue: t('rider.current.banners.searching.title'),
  });
  const sub = t(`rider.current.banners.${status}.sub`, { app: APP_NAME, defaultValue: '' });
  const live = LIVE_STATUSES.includes(status) || status === 'searching';

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingTop: spacing.sm, paddingBottom: spacing.base,
    }}>
      <View style={{
        width: 46, height: 46, borderRadius: radius.md,
        backgroundColor: tone.tint, alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={tone.icon} size={24} color={tone.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          {live ? <PulseDot color={tone.fg} /> : null}
          <AppText variant="h2" numberOfLines={1} style={{ flex: 1 }}>{title}</AppText>
        </View>
        <AppText variant="caption" color={colors.ink2} numberOfLines={2} style={{ marginTop: 2 }}>
          {distanceM != null && LIVE_STATUSES.includes(status)
            ? t('rider.current.map.distanceAway', { distance: formatDistance(distanceM) })
            : sub || t('rider.current.map.captainOnTheWay')}
        </AppText>
      </View>
    </View>
  );
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}

function CaptainCard({ captain }: { captain: Captain }) {
  const { t } = useTranslation();
  return (
    <View style={{
      backgroundColor: colors.surfaceAlt, borderRadius: radius.lg, padding: spacing.base,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{
          width: 48, height: 48, borderRadius: 24,
          backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="person" size={30} color={colors.ember} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="title" numberOfLines={1}>
            {captain.fullName ?? t('rider.current.fallbackName')}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <Icon name="star" size={13} color={colors.sun} />
            <AppText variant="caption" color={colors.ink2}>
              {captain.ratingAvg > 0 ? captain.ratingAvg.toFixed(1) : '—'}
              {'  ·  '}
              {t('rider.current.ridesCount', { count: captain.totalRides })}
            </AppText>
          </View>
        </View>
        {/* Calling the captain is the highest-intent action on this screen once
            someone is assigned — it gets the ember, at thumb size. */}
        <PressableScale
          onPress={() => Linking.openURL(`tel:${captain.phone}`)}
          accessibilityLabel={t('rider.current.yourDriver')}
          style={{
            width: 46, height: 46, borderRadius: 23, backgroundColor: colors.ember,
            alignItems: 'center', justifyContent: 'center', ...shadow.ember,
          }}
        >
          <Icon name="phone" size={22} color={colors.onEmber} />
        </PressableScale>
      </View>

      {captain.vehicle ? (
        <View style={{
          marginTop: spacing.md, paddingTop: spacing.md,
          borderTopWidth: 1, borderTopColor: colors.line,
          flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        }}>
          <View style={{ flex: 1 }}>
            <AppText variant="overline" color={colors.muted}>
              {t('rider.current.vehicleLabel')}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={1} style={{ marginTop: 2 }}>
              {captain.vehicle.color} {captain.vehicle.brand} {captain.vehicle.model}
            </AppText>
          </View>
          {/* The plate is what you match against a car pulling up — it earns
              its own high-contrast chip. */}
          <View style={{
            backgroundColor: colors.espresso, borderRadius: radius.sm,
            paddingHorizontal: spacing.md, paddingVertical: 7,
          }}>
            <AppText variant="bodyStrong" color={colors.onEspresso} tracking={1.5}>
              {captain.vehicle.plate}
            </AppText>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Pickup → dropoff, drawn as a route rail (dot, line, square) so the two are
 * read as one journey rather than two unrelated fields.
 */
function TripCard({ ride }: { ride: Ride }) {
  const { t } = useTranslation();
  // For an open ride still in progress we already show the live meter card
  // above, so the fare row here would duplicate. Display the running total
  // post-completion instead.
  const fare = ride.fareFinalMru
    ?? (ride.rideType === 'private_driver' ? ride.privateDriverDetails?.bookedFareMru ?? ride.fareEstimateMru
    : ride.isOpen ? ride.liveMeter?.fareMru ?? null : ride.fareEstimateMru);

  return (
    <View style={{ marginTop: spacing.base }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        {/* The rail. Fixed width column so both labels align to one edge. */}
        <View style={{ width: 14, alignItems: 'center', paddingTop: 6 }}>
          <View style={{
            width: 11, height: 11, borderRadius: 6,
            borderWidth: 3, borderColor: colors.success,
          }} />
          <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 4 }} />
          <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: colors.ink }} />
        </View>

        <View style={{ flex: 1, gap: spacing.base }}>
          <View>
            <AppText variant="overline" color={colors.muted}>{t('common.from')}</AppText>
            <AppText variant="bodyStrong" numberOfLines={2} style={{ marginTop: 2 }}>
              {ride.pickup.label ?? t('rider.history.pickupFallback')}
            </AppText>
          </View>
          <View>
            <AppText variant="overline" color={colors.muted}>
              {ride.isOpen ? t('rider.current.openDestination') : t('common.to')}
            </AppText>
            <AppText variant="bodyStrong" numberOfLines={2} style={{ marginTop: 2 }}>
              {ride.isOpen && !ride.dropoff?.label
                ? t('rider.current.openDestinationValue')
                : (ride.dropoff?.label ?? t('rider.history.dropoffFallback'))}
            </AppText>
          </View>
        </View>
      </View>

      <View style={{
        flexDirection: 'row', gap: spacing.md, marginTop: spacing.base,
        borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.base,
      }}>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={colors.muted}>{t('rider.current.fare')}</AppText>
          <AppText variant="title" style={{ marginTop: 2 }}>
            {fare == null ? '—' : formatMru(fare)}
          </AppText>
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={colors.muted}>{t('rider.current.payment')}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Icon
              name={ride.paymentMethod === 'cash' ? 'cash' : 'wallet'}
              size={17}
              color={colors.ink2}
            />
            <AppText variant="title">
              {ride.paymentMethod === 'cash' ? t('rider.current.cash') : t('rider.current.wallet')}
            </AppText>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Hero card displayed during an in-progress open ride. Big running fare,
 * km + minutes side by side. The fare polls every 3 s through the parent's
 * usePolling, so it feels live without us running a local timer.
 */
function LiveMeterCard({ ride }: { ride: Ride }) {
  const { t } = useTranslation();
  const m = ride.liveMeter;
  // Soft pulse on the fare to make "this number is alive" obvious.
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
    <View style={{
      marginTop: spacing.base, backgroundColor: colors.espresso,
      borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <PulseDot color={colors.saffron} />
        <AppText variant="overline" color={colors.saffron}>
          {t('rider.current.openMeterLive')}
        </AppText>
      </View>

      <Animated.View style={{ transform: [{ scale: pulse }], alignSelf: 'flex-start' }}>
        <AppText variant="hero" color={colors.onEspresso}>
          {formatMru(m?.fareMru ?? 0)}
        </AppText>
      </Animated.View>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <MeterTile
          label={t('rider.current.openMeterDistance')}
          value={km}
          unit="km"
        />
        <MeterTile
          label={t('rider.current.openMeterDuration')}
          value={`${minutes}:${String(seconds).padStart(2, '0')}`}
        />
      </View>

      {ride.openTariff ? (
        <AppText variant="caption" color={colors.onEspressoMuted}>
          {t('rider.current.openMeterTariffSummary', {
            base: ride.openTariff.baseFareMru,
            perKm: ride.openTariff.perKmMru,
            perMin: ride.openTariff.perMinuteMru,
          })}
        </AppText>
      ) : null}
    </View>
  );
}

/** One stat inside a dark meter card. */
function MeterTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: colors.espressoAlt, borderRadius: radius.sm,
      paddingVertical: spacing.md, paddingHorizontal: spacing.base,
    }}>
      <AppText variant="overline" color={colors.onEspressoMuted}>{label}</AppText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
        <AppText variant="h2" color={colors.onEspresso}>{value}</AppText>
        {unit ? <AppText variant="caption" color={colors.onEspressoMuted}>{unit}</AppText> : null}
      </View>
    </View>
  );
}

function PrivateDriverTimerCard({
  startedAt, bookedDurationH, bookedFareMru,
}: { startedAt: string; bookedDurationH: number; bookedFareMru: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [startedAt]);

  const totalBookedS = bookedDurationH * 3600;
  const remaining = totalBookedS - elapsed;
  const isOvertime = remaining < 0;
  const displayS = Math.abs(remaining);
  const hours = Math.floor(displayS / 3600);
  const mins = Math.floor((displayS % 3600) / 60);
  const secs = displayS % 60;
  const accent = isOvertime ? colors.danger : colors.saffron;

  return (
    <View style={{
      marginTop: spacing.base, backgroundColor: colors.espresso,
      borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <PulseDot color={accent} />
        {/* NOTE: these four labels are hardcoded French — they predate the
            i18n pass and have no keys yet. Everything else on this screen is
            translated. */}
        <AppText variant="overline" color={accent}>
          {isOvertime ? 'TEMPS DÉPASSÉ' : 'Captain PRIVÉ'}
        </AppText>
      </View>

      <AppText variant="display" color={colors.onEspresso}>
        {isOvertime ? '+' : ''}{hours}:{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
      </AppText>

      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <MeterTile label="RÉSERVÉ" value={`${bookedDurationH}h`} />
        <MeterTile label="TARIF" value={formatMru(bookedFareMru)} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ *
 *  Small shared pieces
 * ------------------------------------------------------------------ */

/**
 * Round, floating back button. On the map layout it is the only chrome over
 * the map, so it carries its own surface and shadow to stay legible against
 * whatever the tiles happen to be underneath.
 */
function BackButton({ onPress, inline }: { onPress: () => void; inline?: boolean }) {
  const { t } = useTranslation();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityLabel={t('common.back')}
      hitSlop={8}
      style={{
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: colors.surface,
        alignItems: 'center', justifyContent: 'center',
        alignSelf: 'flex-start',
        marginBottom: inline ? spacing.base : 0,
        ...shadow.card,
      }}
    >
      <Icon name="chevronBack" size={24} color={colors.ink} />
    </PressableScale>
  );
}

/** A soft breathing dot — "this is live, not a screenshot". */
function PulseDot({ color }: { color: string }) {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(o, { toValue: 0.25, duration: 850, useNativeDriver: true }),
      Animated.timing(o, { toValue: 1, duration: 850, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, opacity: o }} />;
}

/* ------------------------------------------------------------------ *
 *  Rating
 * ------------------------------------------------------------------ */

function RatingSheet({
  visible, ride, onDone,
}: {
  visible: boolean;
  ride: Ride | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const ar = isRTL(currentLanguage());
  const insets = useSafeAreaInsets();
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
    <Sheet
      visible={visible}
      // Dragging it away or tapping outside means the same thing the buttons
      // already offer — "later". Rating is a favour the user is doing us; a
      // prompt with no way out would be the wrong way to ask for it.
      onClose={onDone}
      dismissible={!submitting}
      title={askFavorite
        ? t('rider.current.rating.favoriteTitle', {
            name: captain.fullName ?? t('rider.current.rating.favoriteFallbackName'),
          })
        : t('rider.current.rating.question')}
      subtitle={askFavorite
        ? t('rider.current.rating.favoriteHint')
        : t('rider.current.rating.withDriver', {
            name: captain.fullName ?? t('rider.current.rating.withDriverFallback'),
          })}
      contentStyle={{ gap: spacing.base, paddingBottom: spacing.sm }}
    >
          {askFavorite ? (
            <>
              <View style={{
                width: 52, height: 52, borderRadius: radius.md,
                backgroundColor: colors.emberSoft, alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name="drivers" size={28} color={colors.ember} />
              </View>
              <Button
                title={t('rider.current.rating.favoriteAdd')}
                icon="drivers"
                busy={submitting}
                disabled={submitting}
                onPress={addFavorite}
              />
              <Pressable
                disabled={submitting}
                onPress={onDone}
                hitSlop={8}
                style={{ alignItems: 'center', paddingVertical: spacing.sm }}
              >
                <AppText variant="caption" color={colors.ink2}>{t('common.noThanks')}</AppText>
              </Pressable>
            </>
          ) : (
            <>
              <View style={{
                flexDirection: 'row', justifyContent: 'center',
                gap: spacing.sm, paddingVertical: spacing.sm,
              }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <PressableScale key={n} onPress={() => setStars(n)} hitSlop={6} scaleTo={0.85}>
                    <Icon
                      name="star"
                      size={40}
                      color={n <= stars ? colors.sun : colors.lineStrong}
                    />
                  </PressableScale>
                ))}
              </View>

              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder={t('rider.current.rating.commentPlaceholder')}
                placeholderTextColor={colors.faint}
                multiline
                style={{
                  borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md,
                  paddingHorizontal: spacing.md, paddingVertical: spacing.md,
                  fontSize: 15, color: colors.ink, backgroundColor: colors.sunken,
                  minHeight: 68, textAlignVertical: 'top',
                  fontFamily: ar ? fonts.arabic.regular : fonts.text.regular,
                }}
                maxLength={500}
              />

              <Button
                title={t('rider.current.rating.submit')}
                icon="send"
                busy={submitting}
                disabled={submitting || stars === 0}
                onPress={submit}
              />
              <Pressable
                disabled={submitting}
                onPress={onDone}
                hitSlop={8}
                style={{ alignItems: 'center', paddingVertical: spacing.xs }}
              >
                <AppText variant="caption" color={colors.ink2}>{t('common.later')}</AppText>
              </Pressable>
            </>
          )}
    </Sheet>
  );
}
