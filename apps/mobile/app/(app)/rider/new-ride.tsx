import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Easing, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, Text, TextInput, View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import {
  RoadReportButton, RoadReportMarkers, useRoadReports,
} from '@/components/RoadReports';
// Voice-to-location (automated) removed in Phase 2 — voice ordering now lives
// in the dedicated record→wait flow at /(app)/rider/voice-ride. This screen is
// the manual map picker.

// Nouakchott — Tevragh Zeina
const DEFAULT_REGION: Region = {
  latitude: 18.0853, longitude: -15.9785,
  latitudeDelta: 0.05, longitudeDelta: 0.05,
};

interface Point { lat: number; lng: number; label?: string }
interface GeoResult { id: string; label: string; name: string; lat: number; lng: number }

type RideKind = 'self' | 'other' | 'colis';

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
  const mapRef = useRef<MapView>(null);

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
      ? params.kind
      : null;

  const [pickup, setPickup] = useState<Point | null>(prefilledPickup);
  const [dropoff, setDropoff] = useState<Point | null>(prefilledDropoff);
  const [active, setActive] = useState<'pickup' | 'dropoff' | null>(null);
  const [estimate, setEstimate] = useState<{ fareMru: number; distanceM: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('+222');
  // 'colis' = package delivery
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('+222');
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
          label: 'Ma position',
        };
        if (!pickup) setPickup(p);
        else if (!dropoff) setDropoff(p);
        mapRef.current?.animateToRegion({
          latitude: p.lat, longitude: p.lng,
          latitudeDelta: 0.03, longitudeDelta: 0.03,
        }, 500);
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
  useEffect(() => { if (kind === 'colis' && isOpen) setIsOpen(false); }, [kind, isOpen]);

  // Recompute estimate whenever both ends are set — closed rides only.
  useEffect(() => {
    if (isOpen) { setEstimate(null); return; }
    if (!pickup || !dropoff) { setEstimate(null); return; }
    let cancelled = false;
    setEstimating(true);
    api.post<{ fareMru: number; distanceM: number }>('/rider/rides/estimate', {
      pickup: { lat: pickup.lat, lng: pickup.lng },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng },
      // Colis runs use a different (cheaper) tariff — make sure the price
      // shown matches what will actually be charged at booking time.
      rideType: kind === 'colis' ? 'colis' : 'passenger',
    })
      .then((r) => { if (!cancelled) setEstimate(r.data); })
      .catch(() => { if (!cancelled) setEstimate(null); })
      .finally(() => { if (!cancelled) setEstimating(false); });
    return () => { cancelled = true; };
  }, [pickup, dropoff, kind, isOpen]);

  const onMapPress = useCallback((e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const p: Point = { lat: latitude, lng: longitude, label: 'Point sur la carte' };
    if (active === 'pickup' || (!active && !pickup)) setPickup(p);
    else setDropoff(p);
  }, [active, pickup]);

  const onPickFromSearch = useCallback((g: GeoResult) => {
    const p: Point = { lat: g.lat, lng: g.lng, label: g.name };
    if (active === 'pickup') setPickup(p);
    else if (active === 'dropoff') setDropoff(p);
    setActive(null);
    mapRef.current?.animateToRegion({
      latitude: g.lat, longitude: g.lng,
      latitudeDelta: 0.02, longitudeDelta: 0.02,
    }, 400);
  }, [active]);

  function isReady(): { ok: true } | { ok: false; reason: string } {
    if (!pickup) return { ok: false, reason: t('rider.newRide.missingPoints') };
    if (!isOpen && !dropoff) return { ok: false, reason: t('rider.newRide.missingPoints') };
    if (kind === 'other') {
      if (passengerName.trim().length < 2) return { ok: false, reason: t('rider.newRide.thirdPartyName') };
      if (passengerPhone.replace(/\D/g, '').length < 11) return { ok: false, reason: t('phonePrompt.invalidBody') };
    }
    if (kind === 'colis') {
      if (recipientName.trim().length < 2) return { ok: false, reason: t('rider.newRide.recipientName') };
      if (recipientPhone.replace(/\D/g, '').length < 11) return { ok: false, reason: t('phonePrompt.invalidBody') };
    }
    return { ok: true };
  }

  async function confirm() {
    const ready = isReady();
    if (!ready.ok) { Alert.alert(t('common.incomplete'), ready.reason); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        pickup,
        rideType: kind === 'colis' ? 'colis' : 'passenger',
        paymentMethod: 'cash',
      };
      if (isOpen) {
        body.isOpen = true;
      } else {
        body.dropoff = dropoff;
      }
      if (kind === 'other') {
        body.passengerName = passengerName.trim();
        body.passengerPhone = passengerPhone.trim();
      }
      if (kind === 'colis') {
        body.recipientName = recipientName.trim();
        body.recipientPhone = recipientPhone.trim();
        if (packageDescription.trim()) body.packageDescription = packageDescription.trim();
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
      <View style={{ padding: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: -8 }}>
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

        {kind !== 'colis' && openQuote?.enabled ? (
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
                <SmallInput
                  label={t('rider.newRide.thirdPartyPhone')}
                  value={passengerPhone} onChange={setPassengerPhone}
                  placeholder="+22245…" keyboardType="phone-pad"
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
                <SmallInput
                  label={t('rider.newRide.recipientPhone')}
                  value={recipientPhone} onChange={setRecipientPhone}
                  placeholder="+22245…" keyboardType="phone-pad"
                />
              }
            />
            <SmallInput
              label={t('rider.newRide.senderPhone')}
              value={packageDescription} onChange={setPackageDescription}
              placeholder="…"
            />
          </View>
        ) : null}
      </View>

      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={DEFAULT_REGION}
          onPress={onMapPress}
          showsUserLocation
        >
          {pickup ? (
            <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} pinColor="#2d4fd6" />
          ) : null}
          {dropoff ? (
            <Marker coordinate={{ latitude: dropoff.lat, longitude: dropoff.lng }} pinColor="#dc2626" />
          ) : null}
          <RoadReportMarkers reports={reports} />
        </MapView>
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
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <View style={{ padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Pressable onPress={onClose}>
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
        }}
      />
    </View>
  );
}
