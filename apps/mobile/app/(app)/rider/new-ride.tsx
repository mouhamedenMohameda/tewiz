import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal,
  Platform, Pressable, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { formatMru } from '@/lib/format';
import {
  RoadReportButton, RoadReportMarkers, useRoadReports,
} from '@/components/RoadReports';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { VoiceCandidateSheet } from '@/components/VoiceCandidateSheet';
import {
  voiceToLocation, confirmLocation,
  type SideBlock, type Side, type Candidate, type VoiceToLocationResponse,
} from '@/lib/voiceLocation';

// Nouakchott — Tevragh Zeina
const DEFAULT_REGION: Region = {
  latitude: 18.0853, longitude: -15.9785,
  latitudeDelta: 0.05, longitudeDelta: 0.05,
};

interface Point { lat: number; lng: number; label?: string }
interface GeoResult { id: string; label: string; name: string; lat: number; lng: number }

type RideKind = 'self' | 'other' | 'colis';

export default function NewRideScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [active, setActive] = useState<'pickup' | 'dropoff' | null>(null);
  const [estimate, setEstimate] = useState<{ fareKhoums: number; distanceM: number } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Course type + per-type fields. Default = self (most common).
  const [kind, setKind] = useState<RideKind>('self');
  // 'other' = course pour quelqu'un d'autre (no app, SMS confirmation)
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('+222');
  // 'colis' = package delivery
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('+222');
  const [packageDescription, setPackageDescription] = useState('');

  const { reports, refresh: refreshReports } = useRoadReports();

  // ---- Voice-to-location state -------------------------------------------
  // We keep the full voice response so we can validate /confirm choices
  // and surface the candidate picker on the side that needs it.
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceResponse, setVoiceResponse] = useState<VoiceToLocationResponse | null>(null);
  const [pickerSide, setPickerSide] = useState<Side | null>(null);

  const sideBlockFor = useCallback((side: Side): SideBlock | null => {
    if (!voiceResponse) return null;
    return side === 'pickup' ? voiceResponse.pickup : voiceResponse.destination;
  }, [voiceResponse]);
  // ------------------------------------------------------------------------

  // Try to pre-fill pickup from GPS.
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
        setPickup(p);
        mapRef.current?.animateToRegion({
          latitude: p.lat, longitude: p.lng,
          latitudeDelta: 0.03, longitudeDelta: 0.03,
        }, 500);
      } catch {}
    })();
  }, []);

  // Recompute estimate whenever both ends are set.
  useEffect(() => {
    if (!pickup || !dropoff) { setEstimate(null); return; }
    let cancelled = false;
    setEstimating(true);
    api.post<{ fareKhoums: number; distanceM: number }>('/rider/rides/estimate', {
      pickup: { lat: pickup.lat, lng: pickup.lng },
      dropoff: { lat: dropoff.lat, lng: dropoff.lng },
    })
      .then((r) => { if (!cancelled) setEstimate(r.data); })
      .catch(() => { if (!cancelled) setEstimate(null); })
      .finally(() => { if (!cancelled) setEstimating(false); });
    return () => { cancelled = true; };
  }, [pickup, dropoff]);

  const onMapPress = useCallback((e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    const p: Point = { lat: latitude, lng: longitude, label: 'Point sur la carte' };
    if (active === 'pickup' || (!active && !pickup)) setPickup(p);
    else setDropoff(p);
  }, [active, pickup]);

  // ---- Voice handlers ----------------------------------------------------

  /** Apply a SideBlock to pickup/dropoff state when no confirmation is needed. */
  const applyTopCandidate = useCallback((side: Side, block: SideBlock) => {
    const loc = block.location;
    if (!loc) return;
    const p: Point = { lat: loc.lat, lng: loc.lng, label: block.candidates[0]?.name ?? loc.address };
    if (side === 'pickup') setPickup(p); else setDropoff(p);
  }, []);

  /** Center the map on the most-recently populated coordinate. */
  const animateMapTo = useCallback((lat: number, lng: number) => {
    mapRef.current?.animateToRegion({
      latitude: lat, longitude: lng,
      latitudeDelta: 0.03, longitudeDelta: 0.03,
    }, 500);
  }, []);

  /** Called by VoiceMicButton when the user stops recording. */
  const onVoiceCaptured = useCallback(async (audioUri: string) => {
    setVoiceBusy(true);
    try {
      const resp = await voiceToLocation(audioUri);
      setVoiceResponse(resp);

      if (!resp.ok || resp.intent === 'neither') {
        Alert.alert(
          'Aucun lieu compris',
          'Je n’ai pas reconnu de lieu dans votre message. Réessayez en disant par exemple : « Je pars de X vers Y ».',
        );
        return;
      }

      // For each side we have a result on:
      //   - if needs_confirmation → open the picker (queued: pickup first)
      //   - otherwise auto-apply the top candidate.
      let firstPickerSide: Side | null = null;
      for (const side of ['pickup', 'destination'] as const) {
        const block = side === 'pickup' ? resp.pickup : resp.destination;
        if (!block || !block.location) continue;
        if (block.needs_confirmation) {
          if (!firstPickerSide) firstPickerSide = side;
        } else {
          applyTopCandidate(side, block);
        }
      }
      // Re-center on whatever got filled first.
      const target = resp.pickup?.location ?? resp.destination?.location;
      if (target) animateMapTo(target.lat, target.lng);

      if (firstPickerSide) setPickerSide(firstPickerSide);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur réseau.';
      Alert.alert('Voix indisponible', msg);
    } finally {
      setVoiceBusy(false);
    }
  }, [applyTopCandidate, animateMapTo]);

  /** Called when the user picks one candidate from the bottom sheet. */
  const onCandidateChosen = useCallback(async (c: Candidate) => {
    const side = pickerSide;
    if (!side || !voiceResponse) { setPickerSide(null); return; }

    const block = sideBlockFor(side);
    const p: Point = { lat: c.lat, lng: c.lng, label: c.name };
    if (side === 'pickup') setPickup(p); else setDropoff(p);
    animateMapTo(c.lat, c.lng);

    // Fire-and-forget confirmation — this teaches the backend which
    // candidate the user picked, bumps popularity, and auto-seeds Google
    // results when needed.
    if (voiceResponse.request_id) {
      const placeId = c.google_place_id ?? `osm:${c.poi_id}`;
      confirmLocation({
        request_id: voiceResponse.request_id,
        side,
        place_id: placeId,
        lat: c.lat,
        lng: c.lng,
        name: c.name,
      }).catch(() => undefined);
    }

    // If the other side also needs confirmation, chain to it.
    const otherSide: Side = side === 'pickup' ? 'destination' : 'pickup';
    const otherBlock = voiceResponse[otherSide];
    if (otherBlock?.needs_confirmation && otherBlock.location) {
      setPickerSide(otherSide);
    } else {
      setPickerSide(null);
    }
    // We touched block to suppress the unused-var warning while keeping
    // the API symmetric for the future (e.g. logging the chosen rank).
    void block;
  }, [pickerSide, voiceResponse, sideBlockFor, animateMapTo]);

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
    if (!pickup || !dropoff) return { ok: false, reason: 'Choisissez départ et destination.' };
    if (kind === 'other') {
      if (passengerName.trim().length < 2) return { ok: false, reason: 'Nom du passager requis.' };
      if (passengerPhone.replace(/\D/g, '').length < 11) return { ok: false, reason: 'Numéro du passager invalide.' };
    }
    if (kind === 'colis') {
      if (recipientName.trim().length < 2) return { ok: false, reason: 'Nom du destinataire requis.' };
      if (recipientPhone.replace(/\D/g, '').length < 11) return { ok: false, reason: 'Numéro du destinataire invalide.' };
    }
    return { ok: true };
  }

  async function confirm() {
    const ready = isReady();
    if (!ready.ok) { Alert.alert('Incomplet', ready.reason); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        pickup, dropoff,
        rideType: kind === 'colis' ? 'colis' : 'passenger',
        paymentMethod: 'cash',
      };
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
      Alert.alert('Impossible', err?.issues?.[0]?.message ?? err?.message ?? 'Création échouée.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top']}>
      <View style={{ padding: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()}>
            <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '600' }}>‹</Text>
          </Pressable>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>
            Nouvelle course
          </Text>
        </View>

        <Field
          color="#2d4fd6"
          label="Départ"
          value={pickup?.label ?? null}
          onPress={() => setActive('pickup')}
          onClear={() => setPickup(null)}
        />
        <Field
          color="#dc2626"
          label="Destination"
          value={dropoff?.label ?? null}
          onPress={() => setActive('dropoff')}
          onClear={() => setDropoff(null)}
        />

        <KindSelector value={kind} onChange={setKind} />

        {kind === 'other' ? (
          <View style={{ gap: 6, marginTop: 4 }}>
            <Text style={{ fontSize: 11, color: '#64748b' }}>
              Le passager recevra un SMS de confirmation. Le chauffeur l'appellera directement.
            </Text>
            <TwoCol
              left={
                <SmallInput
                  label="Nom du passager"
                  value={passengerName} onChange={setPassengerName}
                  placeholder="Aminata"
                />
              }
              right={
                <SmallInput
                  label="Téléphone"
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
              Le destinataire recevra un code à 4 chiffres par SMS pour récupérer le colis.
            </Text>
            <TwoCol
              left={
                <SmallInput
                  label="Nom du destinataire"
                  value={recipientName} onChange={setRecipientName}
                  placeholder="Mohamed"
                />
              }
              right={
                <SmallInput
                  label="Téléphone"
                  value={recipientPhone} onChange={setRecipientPhone}
                  placeholder="+22245…" keyboardType="phone-pad"
                />
              }
            />
            <SmallInput
              label="Description du colis (optionnel)"
              value={packageDescription} onChange={setPackageDescription}
              placeholder="Sac noir, documents…"
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
              Touchez la carte ou tapez le nom du lieu — {active === 'pickup' ? 'départ' : 'destination'}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <Text style={{ fontSize: 13, color: '#64748b' }}>Tarif estimé</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>
            {estimating ? '…' : estimate ? formatMru(estimate.fareKhoums) : '—'}
          </Text>
        </View>
        <Pressable
          disabled={!pickup || !dropoff || submitting}
          onPress={confirm}
          style={({ pressed }) => ({
            backgroundColor: pressed ? '#0a7a45' : '#10a35e',
            opacity: !pickup || !dropoff || submitting ? 0.4 : 1,
            paddingVertical: 16, borderRadius: 12,
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          })}
        >
          {submitting && <ActivityIndicator color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            {kind === 'colis' ? 'Envoyer le colis' : 'Commander la course'}
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

      {/* Voice-to-location: floating mic + candidate picker. */}
      <VoiceMicButton onCaptured={onVoiceCaptured} busy={voiceBusy} />
      <VoiceCandidateSheet
        visible={!!pickerSide}
        side={pickerSide}
        block={pickerSide ? sideBlockFor(pickerSide) : null}
        preselectedPoiId={pickerSide ? sideBlockFor(pickerSide)?.candidates[0]?.poi_id ?? null : null}
        onClose={() => setPickerSide(null)}
        onSelect={onCandidateChosen}
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
          {value ?? 'Toucher pour choisir'}
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
                <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '600' }}>Annuler</Text>
              </Pressable>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a', flex: 1, textAlign: 'center' }}>
                {kind === 'pickup' ? 'Choisir le départ' : 'Choisir la destination'}
              </Text>
              <View style={{ width: 56 }} />
            </View>
            <TextInput
              autoFocus
              value={q}
              onChangeText={setQ}
              placeholder="Quartier, hôtel, restaurant…"
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
                    {q.trim().length < 2 ? 'Tapez au moins 2 caractères' : 'Aucun résultat'}
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
  const opts: { value: RideKind; label: string; icon: string }[] = [
    { value: 'self',  label: 'Pour moi',     icon: '🙋' },
    { value: 'other', label: 'Pour un tiers', icon: '👥' },
    { value: 'colis', label: 'Colis',         icon: '📦' },
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
