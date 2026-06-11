import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import {
  RoadReportButton, RoadReportMarkers, useRoadReports,
} from '@/components/RoadReports';

interface Cell {
  h3Index: string;
  centroid: { lat: number; lng: number };
  demandScore: number;
  rideCount30m: number;
  computedAt: string;
}

// Nouakchott — Tevragh Zeina fallback when GPS isn't available.
const FALLBACK_REGION: Region = {
  latitude: 18.0853, longitude: -15.9785,
  latitudeDelta: 0.08, longitudeDelta: 0.08,
};

// Visual circle radius — 5 km = 10 km diameter. Each hot cell paints a wide
// halo so the captain reads "this whole area is hot" rather than "this block".
// Neighbouring cells fully overlap into a single heat blob.
const CELL_RADIUS_M = 5000;

/**
 * demand_score is 0..1. We bin it into 3 tiers — green/orange/red — so the
 * captain can see at a glance where the highest demand is concentrated.
 */
function colorFor(score: number) {
  if (score >= 0.66) return { fill: 'rgba(220, 38, 38, 0.45)', stroke: '#dc2626' };  // red
  if (score >= 0.33) return { fill: 'rgba(245, 158, 11, 0.40)', stroke: '#f59e0b' }; // amber
  return                  { fill: 'rgba(16, 163, 94, 0.30)',  stroke: '#10a35e' };   // green
}

interface Cluster {
  centerLat: number;
  centerLng: number;
  rideCount: number;
  score: number;        // 0..1 — highest cell score in the cluster
  cellCount: number;    // number of H3 cells merged
}

// Haversine distance in metres between two lat/lng points.
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sLat = Math.sin(dLat / 2);
  const sLng = Math.sin(dLng / 2);
  const c = sLat * sLat
          + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sLng * sLng;
  return 2 * R * Math.asin(Math.sqrt(c));
}

/**
 * Greedy clustering: any two cells whose centroids fall within `mergeRadiusM`
 * of each other collapse into a single blob. The blob's centre is the
 * isobarycentre of the merged cells, weighted by ride count — so the centre
 * sits closer to the cells with more demand.
 *
 * Cells are processed hottest-first so high-density spots seed each cluster
 * and absorb their cooler neighbours rather than the other way around.
 */
function clusterCells(cells: Cell[], mergeRadiusM: number): Cluster[] {
  const sorted = [...cells].sort((a, b) => b.demandScore - a.demandScore);
  const used = new Set<string>();
  const out: Cluster[] = [];

  for (const seed of sorted) {
    if (used.has(seed.h3Index)) continue;
    used.add(seed.h3Index);

    let sumLat = seed.centroid.lat * seed.rideCount30m;
    let sumLng = seed.centroid.lng * seed.rideCount30m;
    let totalRides = seed.rideCount30m;
    let maxScore = seed.demandScore;
    let cellCount = 1;

    for (const other of sorted) {
      if (used.has(other.h3Index)) continue;
      if (haversineM(seed.centroid, other.centroid) > mergeRadiusM) continue;
      used.add(other.h3Index);
      sumLat += other.centroid.lat * other.rideCount30m;
      sumLng += other.centroid.lng * other.rideCount30m;
      totalRides += other.rideCount30m;
      maxScore = Math.max(maxScore, other.demandScore);
      cellCount += 1;
    }

    out.push({
      centerLat: sumLat / totalRides,
      centerLng: sumLng / totalRides,
      rideCount: totalRides,
      score: maxScore,
      cellCount,
    });
  }
  return out;
}

export default function HeatmapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null);
  const { reports, refresh: refreshReports } = useRoadReports();

  const load = useCallback(async () => {
    try {
      const r = await api.get<Cell[]>('/captain/heatmap');
      setCells(r.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // The server recomputes every 5 min — refetch every minute so a captain
  // staring at the screen sees the changes without having to pull-to-refresh.
  usePolling(load, 60_000);

  // Try to centre the map on the captain. Falls back silently to Nouakchott.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const p = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        setMyPos(p);
        mapRef.current?.animateToRegion({
          latitude: p.lat, longitude: p.lng,
          latitudeDelta: 0.06, longitudeDelta: 0.06,
        }, 500);
      } catch {}
    })();
  }, []);

  // Merge cells within one circle-diameter of each other into a single blob
  // centred on the isobarycentre (weighted by ride count). Any zone with
  // ≥ 2 rides therefore renders as one circle, not two overlapping ones.
  const clusters = clusterCells(cells, CELL_RADIUS_M);
  const hottest = [...clusters].sort((a, b) => b.score - a.score).slice(0, 3);

  function flyToCluster(c: Cluster) {
    mapRef.current?.animateToRegion({
      latitude: c.centerLat, longitude: c.centerLng,
      latitudeDelta: 0.05, longitudeDelta: 0.05,
    }, 500);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }} edges={['top']}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()}>
          <Text style={{ color: '#64748b', fontSize: 14 }}>‹ Retour</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 6 }}>
          <View>
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#0f172a' }}>
              Zones chaudes
            </Text>
            <Text style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Demande des 2 dernières heures
            </Text>
          </View>
          <Pressable
            onPress={() => { setLoading(true); void load(); }}
            style={({ pressed }) => ({
              backgroundColor: pressed ? '#e2e8f0' : '#fff',
              borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
              borderWidth: 1, borderColor: '#e2e8f0',
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#0f172a' }}>↻</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={{ flex: 1 }}
          initialRegion={FALLBACK_REGION}
          showsUserLocation
          showsMyLocationButton
        >
          {clusters.map((c, idx) => {
            const col = colorFor(c.score);
            return (
              <Circle
                key={`cluster-${idx}`}
                center={{ latitude: c.centerLat, longitude: c.centerLng }}
                radius={CELL_RADIUS_M}
                fillColor={col.fill}
                strokeColor={col.stroke}
                strokeWidth={1}
              />
            );
          })}
          {/* Tap-able markers on top-3 clusters so the captain can identify them */}
          {hottest.map((c, i) => (
            <Marker
              key={`top-${i}`}
              coordinate={{ latitude: c.centerLat, longitude: c.centerLng }}
              title={`#${i + 1} · ${c.rideCount} course${c.rideCount > 1 ? 's' : ''}`}
              description={c.cellCount > 1 ? `${c.cellCount} zones fusionnées` : '2 dernières heures'}
              pinColor="#dc2626"
            />
          ))}
          {/* Active road reports — sand, accidents, police checkpoints, etc. */}
          <RoadReportMarkers reports={reports} />
        </MapView>

        {loading && cells.length === 0 ? (
          <View style={{
            position: 'absolute', top: 16, alignSelf: 'center',
            backgroundColor: '#0f172a', borderRadius: 999,
            paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', gap: 8, alignItems: 'center',
          }}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={{ color: '#fff', fontSize: 12 }}>Chargement…</Text>
          </View>
        ) : null}

        {!loading && cells.length === 0 ? (
          <View style={{
            position: 'absolute', top: 16, left: 16, right: 16,
            backgroundColor: 'rgba(15, 23, 42, 0.9)', borderRadius: 12, padding: 12,
          }}>
            <Text style={{ color: '#fff', fontSize: 13, textAlign: 'center' }}>
              Aucune zone chaude pour l'instant — pas assez de courses récentes.
            </Text>
          </View>
        ) : null}

        {/* Floating "report a hazard" button — use captain GPS if known. */}
        <RoadReportButton at={myPos} onCreated={refreshReports} />

        {/* Legend */}
        {cells.length > 0 ? (
          <View style={{
            position: 'absolute', bottom: 12, left: 12,
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderRadius: 12, padding: 10, gap: 6,
            shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
          }}>
            <LegendRow color="#dc2626" label="Très forte" />
            <LegendRow color="#f59e0b" label="Moyenne" />
            <LegendRow color="#10a35e" label="Faible" />
          </View>
        ) : null}
      </View>

      {/* Top-3 list under the map for quick scanning */}
      {hottest.length > 0 ? (
        <View style={{
          backgroundColor: '#fff',
          borderTopWidth: 1, borderTopColor: '#e2e8f0',
          padding: 14, gap: 8,
        }}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', letterSpacing: 0.5 }}>
            TOP 3
          </Text>
          {hottest.map((c, i) => (
            <Pressable
              key={`top-list-${i}`}
              onPress={() => flyToCluster(c)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingVertical: 8,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: colorFor(c.score).stroke,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: '#0f172a' }}>
                  {c.rideCount} course{c.rideCount > 1 ? 's' : ''} demandée{c.rideCount > 1 ? 's' : ''}
                </Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                  {c.cellCount > 1 ? `${c.cellCount} zones · ` : ''}Sur 2h · {c.centerLat.toFixed(4)}, {c.centerLng.toFixed(4)}
                </Text>
              </View>
              <Text style={{ color: '#94a3b8', fontSize: 18 }}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: '#475569' }}>{label}</Text>
    </View>
  );
}
