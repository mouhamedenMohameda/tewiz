import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { PlainText as Text } from '@/components/ui';
import { fonts } from '@/theme';
import { currentLanguage, isRTL } from '@/lib/i18n';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import { getMapbox, MAPBOX_TOKEN } from '@/lib/mapbox';
import { MapShell } from '@/components/MapShell';
import {
  RoadReportButton, RoadReportMarkers, useRoadReports,
} from '@/components/RoadReports';
// Voice-to-location (automated) removed in Phase 2 — voice ordering now lives
// in the dedicated record→wait flow at /(app)/rider/voice-ride. This screen is
// the manual map picker.

// Nouakchott — Tevragh Zeina
const DEFAULT_CENTER: [number, number] = [-15.9785, 18.0853];
const DEFAULT_ZOOM = 12;

interface Point { lat: number; lng: number; label?: string }
interface GeoResult { id: string; label: string; name: string; lat: number; lng: number }
interface MapboxDirectionsResponse {
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      type: 'LineString';
      coordinates: [number, number][];
    };
  }>;
}

type RideKind = 'self' | 'other' | 'colis';
type PricingMode = 'solo' | 'shared';
const SOLO_PRICING_MODE: PricingMode = 'solo';

/** Parse a Point from a (lat, lng, label) triple that came from query params. */
function parsePoint(
  lat: string | string[] | undefined,
  lng: string | string[] | undefined,
  label: string | string[] | undefined,
): Point | null {
  const latStr = Array.isArray(lat) ? lat[0] : lat;
  const lngStr = Array.isArray(lng) ? lng[0] : lng;
  if (!latStr || !lngStr) return null;
  const latN = Number(latStr);
  const lngN = Number(lngStr);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) return null;
  const labelStr = Array.isArray(label) ? label[0] : label;
  return { lat: latN, lng: lngN, label: labelStr || undefined };
}

export default function NewRideScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const M = getMapbox();
  const cameraRef = useRef<any>(null);
  // The map lives inside a ScrollView so the pickup/dropoff fields and the
  // per-type detail inputs (colis/other) can't squeeze it into a sliver on
  // small phones. Give it a generous, screen-relative fixed height instead.
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = Math.max(280, Math.min(440, Math.round(windowHeight * 0.42)));

  // Deep-link params let other screens (e.g. the Restaurants directory) push
  // here with one or both ends already pinned. We just pre-fill the state and
  // wait — booking still requires the user to tap Confirmer.
  //   ?pickupLat/Lng/Label      — pin pickup from caller
  //   ?dropoffLat/Lng/Label     — pin dropoff from caller
  //   ?kind=self|other|colis    — pre-select the course type
  const params = useLocalSearchParams<{
    pickupLat?: string; pickupLng?: string; pickupLabel?: string;
    dropoffLat?: string; dropoffLng?: string; dropoffLabel?: string;
    kind?: string;
  }>();
  const prefilledPickup = parsePoint(params.pickupLat, params.pickupLng, params.pickupLabel);
  const prefilledDropoff = parsePoint(params.dropoffLat, params.dropoffLng, params.dropoffLabel);
  const prefilledKind: RideKind | null =
    params.kind === 'self' || params.kind === 'other' || params.kind === 'colis'
      ? (params.kind as RideKind)
      : null;

  const [pickup, setPickup] = useState<Point | null>(prefilledPickup);
  const [dropoff, setDropoff] = useState<Point | null>(prefilledDropoff);
  const [active, setActive] = useState<'pickup' | 'dropoff' | null>(null);
  const [estimate, setEstimate] = useState<{
    fareMru: number;
    distanceM: number;
    pricingMode: PricingMode;
    sharedSeats: number | null;
    soloFareMru: number | null;
    isIntercityPricing: boolean;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][] | null>(null);
  const [routeMetrics, setRouteMetrics] = useState<{ distanceM: number; durationS: number } | null>(null);
  // Course ouverte — taxi à la course, sans destination fixée. Toggle visible
  // only for passenger rides (open metered fare is meaningless for colis).
  // openQuote=null while loading; openQuote.enabled=false → admin disabled the
  // feature, we hide the toggle altogether.
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [openQuote, setOpenQuote] = useState<{
    enabled: boolean;
    baseFareMru: number;
    perKmMru: number;
    perMinuteMru: number;
    minFareMru: number;
  } | null>(null);

  // Course type + per-type fields. Default = self (most common), unless a
  // caller deep-linked us with an explicit kind.
  const [kind, setKind] = useState<RideKind>(prefilledKind ?? 'self');
  // 'other' = course pour quelqu'un d'autre (no app, SMS confirmation)
  // Phone fields hold ONLY the 8 local digits — the "+222" country code is a
  // fixed prefix rendered by <PhoneInput> and re-attached at submit time, so
  // users just type "45 12 34 56" instead of fighting a pre-filled "+222".
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  // 'colis' = package delivery
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [packageDescription, setPackageDescription] = useState('');

  const { reports, refresh: refreshReports } = useRoadReports();

  // Try to pre-fill the missing end (pickup OR dropoff) from GPS.
  //   - Standard ride: pickup empty → GPS fills pickup, dropoff stays empty.
  //   - Restaurant ride (dropoff pre-pinned): GPS fills the empty pickup.
  //   - Restaurant colis (pickup pre-pinned): GPS fills the empty dropoff so
  //     the parcel goes from restaurant to "Ma position".
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const p: Point = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          label: t('rider.newRide.myPositionLabel'),
        };
        if (!pickup) setPickup(p);
        else if (!dropoff) setDropoff(p);
        cameraRef.current?.setCamera({
          centerCoordinate: [p.lng, p.lat],
          zoomLevel: 13,
          animationDuration: 500,
        });
      } catch {}
    })();
    // Run once at mount — we don't want to keep stomping pickup/dropoff when
    // the user changes them later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the open-ride tariff once. Cheap (single row) and lets us hide the
  // toggle entirely when the admin disabled the feature.
  useEffect(() => {
    let cancelled = false;
    api.get<typeof openQuote>('/rider/rides/open-quote')
      .then((r) => { if (!cancelled && r.data) setOpenQuote(r.data); })
      .catch(() => { /* feature simply stays hidden */ });
    return () => { cancelled = true; };
  }, []);

  // Course ouverte is only meaningful for passenger rides (no destination →
  // no parcel handover). Auto-disable when the user picks colis.
  useEffect(() => { if ((kind === 'colis') && isOpen) setIsOpen(false); }, [kind, isOpen]);
  // Recompute estimate whenever both ends are set — closed rides only.
  useEffect(() => {
    if (isOpen) { setEstimate(null); return; }
    if (!pickup || !dropoff) { setEstimate(null); return; }
    let cancelled = false;
    setEstimating(true);
    api.post<{
      fareMru: number;
      distanceM: number;
      pricingMode: PricingMode;
      sharedSeats: number | null;
      soloFareMru: number | null;
      isIntercityPricing: boolean;
    }>('/rider/rides/estimate', {
      pickup: { lat: pickup.lat, lng: pickup.lng },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng },
      rideType: kind === 'colis' ? 'colis' : 'passenger',
      ...(kind !== 'colis' ? { pricingMode: SOLO_PRICING_MODE } : {}),
    })
      .then((r) => { if (!cancelled) setEstimate(r.data); })
      .catch(() => { if (!cancelled) setEstimate(null); })
      .finally(() => { if (!cancelled) setEstimating(false); });
    return () => { cancelled = true; };
  }, [pickup, dropoff, kind, isOpen]);

  const onMapPress = useCallback((lngLat: [number, number]) => {
    const p: Point = { lat: lngLat[1], lng: lngLat[0] };
    if (active === 'pickup' || (!active && !pickup)) setPickup(p);
    else setDropoff(p);
  }, [active, pickup]);

  const onPickFromSearch = useCallback((g: GeoResult) => {
    const p: Point = { lat: g.lat, lng: g.lng, label: g.name };
    if (active === 'pickup') setPickup(p);
    else if (active === 'dropoff') setDropoff(p);
    setActive(null);
    cameraRef.current?.setCamera({
      centerCoordinate: [g.lng, g.lat],
      zoomLevel: 14,
      animationDuration: 400,
    });
  }, [active]);

  useEffect(() => {
    if (!pickup || !dropoff) {
      setRouteCoordinates(null);
      setRouteMetrics(null);
      return;
    }
    if (!MAPBOX_TOKEN) {
      setRouteCoordinates([
        [pickup.lng, pickup.lat],
        [dropoff.lng, dropoff.lat],
      ]);
      setRouteMetrics(null);
      return;
    }

    const from = `${pickup.lng},${pickup.lat}`;
    const to = `${dropoff.lng},${dropoff.lat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from};${to}`
      + `?overview=full&geometries=geojson&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`directions_${r.status}`);
        const data = (await r.json()) as MapboxDirectionsResponse;
        const route = data.routes?.[0];
        const coords = route?.geometry?.coordinates;
        if (!cancelled) {
          setRouteCoordinates(
            coords && coords.length >= 2
              ? coords
              : [[pickup.lng, pickup.lat], [dropoff.lng, dropoff.lat]],
          );
          setRouteMetrics(
            route?.distance && route?.duration
              ? { distanceM: route.distance, durationS: route.duration }
              : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRouteCoordinates([[pickup.lng, pickup.lat], [dropoff.lng, dropoff.lat]]);
          setRouteMetrics(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pickup, dropoff]);

  useEffect(() => {
    if (!routeCoordinates || routeCoordinates.length < 2) return;
    const lngs = routeCoordinates.map((c) => c[0]);
    const lats = routeCoordinates.map((c) => c[1]);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    cameraRef.current?.fitBounds(
      [maxLng, maxLat],
      [minLng, minLat],
      [60, 60, 140, 60],
      600,
    );
  }, [routeCoordinates]);

  const routeGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!routeCoordinates || routeCoordinates.length < 2) return null;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: routeCoordinates,
        },
        properties: {},
      }],
    };
  }, [routeCoordinates]);

  const routeDistanceKm = routeMetrics ? (routeMetrics.distanceM / 1000).toFixed(1) : null;
  const routeDurationMin = routeMetrics ? Math.max(1, Math.round(routeMetrics.durationS / 60)) : null;

  function isReady(): { ok: true } | { ok: false; reason: string } {
    if (!pickup) return { ok: false, reason: t('rider.newRide.missingPoints') };
    if (!isOpen && !dropoff) return { ok: false, reason: t('rider.newRide.missingPoints') };
    if (kind === 'other') {
      if (passengerName.trim().length < 2) return { ok: false, reason: t('rider.newRide.thirdPartyName') };
      if (passengerPhone.length < 8) return { ok: false, reason: t('phonePrompt.invalidBody') };
    }
    if (kind === 'colis') {
      if (recipientName.trim().length < 2) return { ok: false, reason: t('rider.newRide.recipientName') };
      if (recipientPhone.length < 8) return { ok: false, reason: t('phonePrompt.invalidBody') };
    }
    return { ok: true };
  }

  async function confirm() {
    const ready = isReady();
    if (!ready.ok) { Alert.alert(t('common.incomplete'), ready.reason); return; }
    setSubmitting(true);
    try {
      const rideType = kind === 'colis' ? 'colis' : 'passenger';
      const body: Record<string, unknown> = {
        pickup,
        rideType,
        paymentMethod: 'cash',
        ...(kind !== 'colis' && !isOpen ? { pricingMode: SOLO_PRICING_MODE } : {}),
      };
      if (isOpen) {
        body.isOpen = true;
      } else {
        body.dropoff = dropoff;
      }
      if (kind === 'other') {
        body.passengerName = passengerName.trim();
        body.passengerPhone = `+222${passengerPhone}`;
      }
      if (kind === 'colis') {
        body.recipientName = recipientName.trim();
        body.recipientPhone = `+222${recipientPhone}`;
        if (packageDescription) body.packageDescription = `+222${packageDescription}`;
      }
      await api.post('/rider/rides', body);
      router.replace('/(app)/rider/current');
    } catch (e: any) {
      const err = e.response?.data?.error;
      Alert.alert(t('common.impossible'), err?.issues?.[0]?.message ?? err?.message ?? t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top']}>
      {/* Pinned header — stays put while the form + map scroll below it. */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginStart: -8 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            style={({ pressed }) => ({
              width: 40, height: 40, borderRadius: 20,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: pressed ? '#f1f5f9' : 'transparent',
            })}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Text style={{ color: '#0f172a', fontSize: 30, fontWeight: '600', lineHeight: 32, marginTop: -2 }}>‹</Text>
          </Pressable>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>
            {t('rider.newRide.title')}
          </Text>
        </View>
      </View>

      {/* Form + map scroll together so the detail inputs never squeeze the map
          into a sliver; the map keeps a fixed, comfortable height. */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 12 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Field
            color="#2d4fd6"
            label={t('rider.newRide.pickupLabel')}
            value={pickup?.label ?? null}
            onPress={() => setActive('pickup')}
            onClear={() => setPickup(null)}
          />

          {isOpen ? (
            <OpenFareCard quote={openQuote} />
          ) : (
            <Field
              color="#dc2626"
              label={t('rider.newRide.dropoffLabel')}
              value={dropoff?.label ?? null}
              onPress={() => setActive('dropoff')}
              onClear={() => setDropoff(null)}
            />
          )}

          {openQuote?.enabled ? (
            <OpenRideToggle
              value={isOpen}
              onChange={setIsOpen}
            />
          ) : null}

          <KindSelector value={kind} onChange={setKind} />

          {kind === 'other' ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              <Text style={{ fontSize: 11, color: '#64748b' }}>
                {t('rider.newRide.thirdPartyHint')}
              </Text>
              <TwoCol
                left={
                  <SmallInput
                    label={t('rider.newRide.thirdPartyName')}
                    value={passengerName} onChange={setPassengerName}
                    placeholder="Aminata"
                  />
                }
                right={
                  <PhoneInput
                    label={t('rider.newRide.thirdPartyPhone')}
                    value={passengerPhone} onChange={setPassengerPhone}
                  />
                }
              />
            </View>
          ) : null}

          {kind === 'colis' ? (
            <View style={{ gap: 6, marginTop: 4 }}>
              <Text style={{ fontSize: 11, color: '#64748b' }}>
                {t('rider.newRide.colisHint')}
              </Text>
              <TwoCol
                left={
                  <SmallInput
                    label={t('rider.newRide.recipientName')}
                    value={recipientName} onChange={setRecipientName}
                    placeholder="Mohamed"
                  />
                }
                right={
                  <PhoneInput
                    label={t('rider.newRide.recipientPhone')}
                    value={recipientPhone} onChange={setRecipientPhone}
                  />
                }
              />
              <PhoneInput
                label={t('rider.newRide.senderPhone')}
                value={packageDescription} onChange={setPackageDescription}
              />
            </View>
          ) : null}
        </View>

        <View style={{ height: mapHeight, marginTop: 4 }}>
          <MapShell
            cameraRef={cameraRef}
            centerCoordinate={DEFAULT_CENTER}
            zoomLevel={DEFAULT_ZOOM}
            onPress={onMapPress}
            showsUserLocation
          >
            {M && routeGeoJson ? (
              <M.ShapeSource id="ride-route" shape={routeGeoJson}>
                <M.LineLayer
                  id="ride-route-line"
                  style={{
                    lineColor: '#2563eb',
                    lineWidth: 4,
                    lineOpacity: 0.75,
                  }}
                />
              </M.ShapeSource>
            ) : null}
            {M && pickup ? (
              <M.PointAnnotation
                id="pickup"
                coordinate={[pickup.lng, pickup.lat]}
              >
                <View style={pinStyle('#2d4fd6')} />
              </M.PointAnnotation>
            ) : null}
            {M && dropoff ? (
              <M.PointAnnotation
                id="dropoff"
                coordinate={[dropoff.lng, dropoff.lat]}
              >
                <View style={pinStyle('#dc2626')} />
              </M.PointAnnotation>
            ) : null}
            <RoadReportMarkers reports={reports} />
          </MapShell>
          <RoadReportButton at={pickup ?? null} onCreated={refreshReports} />
          {active ? (
            <View style={{
              position: 'absolute', top: 12, left: 12, right: 12,
              backgroundColor: '#0f172a', borderRadius: 10, padding: 10,
            }}>
              <Text style={{ color: '#fff', fontSize: 12, textAlign: 'center' }}>
                {active === 'pickup' ? t('rider.newRide.searchPickupTitle') : t('rider.newRide.searchDropoffTitle')}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 13, color: '#64748b' }}>
            {isOpen ? t('rider.newRide.openFareLabel') : t('captain.rides.estimatedFare')}
          </Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>
            {isOpen
              ? t('rider.newRide.openFareMeter')
              : (estimating ? '…' : estimate ? formatMru(estimate.fareMru) : '—')}
          </Text>
        </View>
        {!isOpen && estimate?.isIntercityPricing ? (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 12, color: '#64748b' }}>
              {t('rider.newRide.interCitySolo')}
            </Text>
          </View>
        ) : null}
        {!isOpen ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ fontSize: 13, color: '#64748b' }}>
              {t('rider.newRide.distanceDuration')}
            </Text>
            <Text style={{ fontSize: 13, fontWeight: '600', color: '#0f172a' }}>
              {routeDistanceKm && routeDurationMin
                ? `${routeDistanceKm} ${t('common.kmShort')} · ${routeDurationMin} min`
                : '—'}
            </Text>
          </View>
        ) : null}
        <Pressable
          disabled={!pickup || (!isOpen && !dropoff) || submitting}
          onPress={confirm}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#0a7a45' : '#10a35e',
            opacity: !pickup || (!isOpen && !dropoff) || submitting ? 0.4 : 1,
            paddingVertical: 16, borderRadius: 12,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          })}
        >
          {submitting && <ActivityIndicator color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            {isOpen ? t('rider.newRide.submitOpen') : t('rider.newRide.submit')}
          </Text>
        </Pressable>
      </View>

      <SearchSheet
        visible={!!active}
        kind={active}
        proximity={pickup ?? null}
        onPick={onPickFromSearch}
        onClose={() => setActive(null)}
      />
    </SafeAreaView>
  );
}

function Field({
  color, label, value, onPress, onClear,
}: {
  color: string; label: string; value: string | null;
  onPress: () => void; onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12,
    }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Pressable onPress={onPress} style={{ flex: 1 }}>
        <Text style={{ fontSize: 11, color: '#64748b' }}>{label}</Text>
        <Text style={{
          fontSize: 14, color: value ? '#0f172a' : '#94a3b8', marginTop: 2,
        }} numberOfLines={1}>
          {value ?? t('common.tapToReplace')}
        </Text>
      </Pressable>
      {value ? (
        <Pressable onPress={onClear} hitSlop={10}>
          <Text style={{ color: '#94a3b8', fontSize: 18 }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SearchSheet({
  visible, kind, proximity, onPick, onClose,
}: {
  visible: boolean;
  kind: 'pickup' | 'dropoff' | null;
  proximity: Point | null;
  onPick: (g: GeoResult) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search.
  useEffect(() => {
    if (!visible || q.trim().length < 2) { setResults([]); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = `/geocode/search?q=${encodeURIComponent(q.trim())}${
          proximity ? `&proximity=${proximity.lng},${proximity.lat}` : ''
        }`;
        const r = await api.get<{ results: GeoResult[] }>(url);
        if (!cancelled) setResults(r.data.results);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, visible, proximity]);

  useEffect(() => { if (!visible) { setQ(''); setResults([]); } }, [visible]);

  const { t } = useTranslation();
  const ar = isRTL(currentLanguage());
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={{ padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={onClose} hitSlop={12} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '600' }}>{t('common.cancel')}</Text>
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a', flex: 1, textAlign: 'center' }}>
                {kind === 'pickup' ? t('rider.newRide.searchPickupTitle') : t('rider.newRide.searchDropoffTitle')}
              </Text>
              <View style={{ width: 56 }} />
            </View>
            <TextInput
              autoFocus
              value={q}
              onChangeText={setQ}
              placeholder={t('rider.newRide.searchPlaceholder')}
              placeholderTextColor="#94a3b8"
              style={{
                borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10,
                paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#0f172a',
                backgroundColor: '#f8fafc',
                fontFamily: ar ? fonts.arabic.medium : undefined,
              }}
              returnKeyType="search"
            />
          </View>

          {loading ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <ActivityIndicator />
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(it) => it.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 13 }}>
                    {q.trim().length < 2 ? t('rider.newRide.minCharsHint') : t('rider.newRide.noResults')}
                  </Text>
                </View>
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 16, paddingVertical: 14,
                    backgroundColor: pressed ? '#f1f5f9' : '#fff',
                    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
                  })}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#0f172a' }}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }} numberOfLines={1}>
                    {item.label}
                  </Text>
                </Pressable>
              )}
            />
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function KindSelector({
  value, onChange,
}: { value: RideKind; onChange: (k: RideKind) => void }) {
  const { t } = useTranslation();
  const opts: { value: RideKind; label: string; icon: string }[] = [
    { value: 'self',  label: t('rider.newRide.kindFor.self'),  icon: '🙋' },
    { value: 'other', label: t('rider.newRide.kindFor.other'), icon: '👥' },
    { value: 'colis', label: t('rider.newRide.kindFor.colis'), icon: '📦' },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
      {opts.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              flex: 1,
              backgroundColor: active ? '#0f172a' : (pressed ? '#e2e8f0' : '#f1f5f9'),
              paddingVertical: 10, borderRadius: 10,
              alignItems: 'center', gap: 2,
            })}
          >
            <Text style={{ fontSize: 18 }}>{o.icon}</Text>
            <Text style={{
              fontSize: 11, fontWeight: '700',
              color: active ? '#fff' : '#475569',
            }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DurationPicker({
  value, onChange, hourlyRate,
}: { value: number; onChange: (h: number) => void; hourlyRate: number }) {
  const durations = [
    { h: 3, label: '3h' },
    { h: 6, label: '6h' },
    { h: 12, label: '12h' },
    { h: 24, label: 'Journée' },
  ];
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 11, color: '#64748b' }}>Durée de la réservation</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {durations.map((d) => {
          const active = d.h === value;
          return (
            <Pressable
              key={d.h}
              onPress={() => onChange(d.h)}
              style={{
                flex: 1,
                backgroundColor: active ? '#0f172a' : '#f1f5f9',
                paddingVertical: 10, borderRadius: 10,
                alignItems: 'center', gap: 2,
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: '700', color: active ? '#fff' : '#0f172a' }}>
                {d.label}
              </Text>
              <Text style={{ fontSize: 10, color: active ? '#94a3b8' : '#64748b' }}>
                {formatMru(hourlyRate * d.h)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TwoCol({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1 }}>{left}</View>
      <View style={{ flex: 1 }}>{right}</View>
    </View>
  );
}

/**
 * Animated pill toggle for "Course ouverte". Sits below the pickup/dropoff
 * fields. Tapping it (a) hides the dropoff field, (b) swaps in the metered
 * tariff card, (c) flips the bottom CTA copy. Designed to feel like one of
 * those iOS-style switches but bigger so it doesn't get lost between the two
 * map pins.
 */
function OpenRideToggle({
  value, onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#f1f5f9', '#0f172a'],
  });
  const dot = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [3, 27],
  });
  const labelColor = value ? '#fff' : '#475569';

  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={({ pressed }) => ({
        marginTop: 4,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Animated.View style={{
        backgroundColor: bg as unknown as string,
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}>
        <View style={{
          width: 54, height: 30, borderRadius: 15,
          backgroundColor: value ? '#10a35e' : '#cbd5e1',
          justifyContent: 'center',
        }}>
          <Animated.View style={{
            width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
            transform: [{ translateX: dot }],
            shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: labelColor }}>
            {t('rider.newRide.openRideTitle')}
          </Text>
          <Text style={{ fontSize: 11, color: value ? '#cbd5e1' : '#64748b', marginTop: 2 }}>
            {t('rider.newRide.openRideHint')}
          </Text>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Replaces the dropoff field when "Course ouverte" is on. Shows the metered
 * tariff inline (base + per km + per minute, plus the minimum) so the rider
 * knows exactly what they'll be charged before booking.
 */
function OpenFareCard({
  quote,
}: { quote: { baseFareMru: number; perKmMru: number; perMinuteMru: number; minFareMru: number } | null }) {
  const { t } = useTranslation();
  if (!quote) {
    return (
      <View style={{
        backgroundColor: '#fef3c7', borderRadius: 10,
        paddingHorizontal: 12, paddingVertical: 14,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <ActivityIndicator color="#854d0e" />
        <Text style={{ fontSize: 13, color: '#854d0e' }}>{t('common.loading')}</Text>
      </View>
    );
  }
  return (
    <View style={{
      backgroundColor: '#0f172a', borderRadius: 12,
      paddingHorizontal: 14, paddingVertical: 14, gap: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 16 }}>🧮</Text>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: 0.5 }}>
          {t('rider.newRide.openMeterLabel')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <MeterCell value={formatMru(quote.baseFareMru)} label={t('rider.newRide.meterBase')} />
        <MeterCell value={`${quote.perKmMru} MRU`} label={t('rider.newRide.meterPerKm')} />
        <MeterCell value={`${quote.perMinuteMru} MRU`} label={t('rider.newRide.meterPerMin')} />
      </View>
      <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
        {t('rider.newRide.meterMin', { min: formatMru(quote.minFareMru) })}
      </Text>
    </View>
  );
}

function MeterCell({ value, label }: { value: string; label: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: '#1e293b', borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 8, alignItems: 'center',
    }}>
      <Text style={{ fontSize: 14, fontWeight: '800', color: '#fde68a' }}>{value}</Text>
      <Text style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, letterSpacing: 0.4 }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function SmallInput({
  label, value, onChange, placeholder, keyboardType,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'phone-pad';
}) {
  const ar = isRTL(currentLanguage());
  return (
    <View>
      <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#94a3b8"
        keyboardType={keyboardType ?? 'default'}
        style={{
          borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8,
          paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
          color: '#0f172a', backgroundColor: '#fff',
          fontFamily: ar ? fonts.arabic.regular : undefined,
        }}
      />
    </View>
  );
}

/**
 * Local phone entry with a fixed "+222" prefix. The user types only the 8
 * Mauritanian digits (we strip anything non-numeric and cap at 8), so `value`
 * always holds the bare local number — the caller re-attaches "+222" when it
 * builds the request body.
 */
function PhoneInput({
  label, value, onChange,
}: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const ar = isRTL(currentLanguage());
  return (
    <View>
      <Text style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</Text>
      <View style={{
        flexDirection: 'row', alignItems: 'stretch',
        borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8,
        backgroundColor: '#fff', overflow: 'hidden',
      }}>
        <View style={{
          paddingHorizontal: 10, justifyContent: 'center',
          backgroundColor: '#f1f5f9',
          ...(ar
            ? { borderLeftWidth: 1, borderLeftColor: '#cbd5e1' }
            : { borderRightWidth: 1, borderRightColor: '#cbd5e1' }),
        }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#475569' }}>+222</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={(txt) => onChange(txt.replace(/\D/g, '').slice(0, 8))}
          placeholder="45 12 34 56"
          placeholderTextColor="#94a3b8"
          keyboardType="phone-pad"
          maxLength={8}
          style={{
            flex: 1, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
            color: '#0f172a',
            fontFamily: ar ? fonts.arabic.regular : undefined,
          }}
        />
      </View>
    </View>
  );
}

function pinStyle(color: string) {
  return {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: color,
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  } as const;
}
