import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatMru } from '@/lib/format';

// Nouakchott Tevragh Zeina as fallback
const DEFAULT_REGION = {
  latitude: 18.0853,
  longitude: -15.9785,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

interface LatLng { latitude: number; longitude: number }

export default function HomeScreen() {
  const router = useRouter();
  const clear = useAuth((s) => s.clear);
  const fullName = useAuth((s) => s.user?.fullName);

  const mapRef = useRef<MapView | null>(null);

  const [region, setRegion] = useState(DEFAULT_REGION);
  const [pickup, setPickup] = useState<LatLng | null>(null);
  const [dropoff, setDropoff] = useState<LatLng | null>(null);
  const [booking, setBooking] = useState(false);
  const [checking, setChecking] = useState(true);

  // 1. On mount, check if we already have an active ride → redirect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api.get('/rider/rides/current');
        if (!cancelled && r.status === 200 && r.data?.id) {
          router.replace({ pathname: '/(app)/ride/[id]', params: { id: r.data.id } });
          return;
        }
      } catch (e: any) {
        if (e.response?.status !== 204 && e.response?.status !== 404) {
          // ignore — they just don't have a ride
        }
      }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  // 2. Request location permission + set initial position as pickup.
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const ll = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setPickup(ll);
        setRegion({ ...ll, latitudeDelta: 0.02, longitudeDelta: 0.02 });
        mapRef.current?.animateToRegion({
          ...ll, latitudeDelta: 0.02, longitudeDelta: 0.02,
        }, 600);
      } catch {/* ignore */}
    })();
  }, []);

  // 3. Estimate fare (locally — we trust the same formula as the API).
  let estimateMru: number | null = null;
  let estimateKm: number | null = null;
  if (pickup && dropoff) {
    const d = haversineMeters(pickup, dropoff);
    const km = (d * 1.3) / 1000;
    estimateKm = km;
    estimateMru = Math.max(40, Math.round(20 + km * 30)); // 20 + 30/km, min 40
  }

  async function book() {
    if (!pickup || !dropoff) return;
    setBooking(true);
    try {
      const r = await api.post('/rider/rides', {
        pickup: { lat: pickup.latitude, lng: pickup.longitude },
        dropoff: { lat: dropoff.latitude, lng: dropoff.longitude },
      });
      router.replace({ pathname: '/(app)/ride/[id]', params: { id: r.data.id } });
    } catch (e: any) {
      Alert.alert('Erreur',
        e.response?.data?.error?.message ?? 'Impossible de créer la course.');
    } finally {
      setBooking(false);
    }
  }

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>Tewiz</Text>
          <Text style={{ fontSize: 12, color: '#64748b' }}>
            Salam {fullName ?? 'voyageur'}
          </Text>
        </View>
        <Pressable
          onPress={() => clear().then(() => router.replace('/(auth)/phone'))}
          style={{ padding: 8 }}
        >
          <Text style={{ fontSize: 12, color: '#dc2626' }}>Déconnexion</Text>
        </Pressable>
      </View>

      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={{ flex: 1 }}
        initialRegion={region}
        onPress={(e) => setDropoff(e.nativeEvent.coordinate)}
        showsUserLocation
      >
        {pickup && (
          <Marker coordinate={pickup} title="Départ" pinColor="#2d4fd6" />
        )}
        {dropoff && (
          <Marker
            coordinate={dropoff}
            title="Arrivée"
            description="Tapez la carte pour déplacer"
            pinColor="#dc2626"
          />
        )}
      </MapView>

      <View style={styles.bottomSheet}>
        {!dropoff ? (
          <View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: '#0f172a', marginBottom: 4 }}>
              Où allez-vous ?
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b' }}>
              Tapez sur la carte pour choisir votre destination.
            </Text>
          </View>
        ) : (
          <View>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: '#2d4fd6' }]} />
              <Text style={{ flex: 1, color: '#0f172a' }}>Votre position</Text>
            </View>
            <View style={{ height: 8 }} />
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: '#dc2626' }]} />
              <Text style={{ flex: 1, color: '#0f172a' }}>
                Destination ({estimateKm?.toFixed(1)} km)
              </Text>
            </View>

            <View style={styles.estimateBar}>
              <Text style={{ fontSize: 12, color: '#64748b' }}>Tarif estimé</Text>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
                {formatMru((estimateMru ?? 0) * 5 /* convert MRU → khoums for formatter… */)}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => setDropoff(null)}
                style={styles.btnSecondary}
              >
                <Text style={{ color: '#0f172a', fontWeight: '600' }}>Annuler</Text>
              </Pressable>
              <Pressable
                disabled={!pickup || booking}
                onPress={book}
                style={[styles.btnPrimary, { opacity: booking ? 0.5 : 1, flex: 1 }]}
              >
                {booking
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Demander un chauffeur</Text>}
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const A = Math.sin(dLat/2)**2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(A));
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: '#e2e8f0',
  },
  bottomSheet: {
    backgroundColor: '#fff', padding: 20, paddingBottom: 28,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06, shadowRadius: 12, elevation: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  estimateBar: {
    marginVertical: 16, padding: 14, borderRadius: 12,
    backgroundColor: '#f1f5f9',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  btnPrimary: {
    backgroundColor: '#2d4fd6', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  btnSecondary: {
    backgroundColor: '#e2e8f0', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
});
