import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Circle, Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import {
  RoadReportButton, RoadReportMarkers, useRoadReports,
} from '@/components/RoadReports';
import { AppText, Icon } from '@/components/ui';
import { colors, radius, shadow, spacing } from '@/theme';

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
 * demand_score is 0..1. We bin it into 3 tiers on a warm heat ramp
 * (gold → orange → red) so the captain can see at a glance where the highest
 * demand is concentrated.
 */
function colorFor(score: number) {
  if (score >= 0.66) return { fill: 'rgba(214, 69, 47, 0.45)', stroke: '#D6452F' };  // red — very hot
  if (score >= 0.33) return { fill: 'rgba(242, 104, 44, 0.38)', stroke: '#F2682C' }; // ember — warm
  return                  { fill: 'rgba(246, 166, 35, 0.30)',  stroke: '#F6A623' };   // gold — mild
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
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top']}>
      <View style={{
        paddingHorizontal: spacing.base, paddingBottom: spacing.sm, paddingTop: spacing.xs,
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{
            width: 44, height: 44, borderRadius: radius.md,
            backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card,
          }}
        >
          <Icon name="chevronBack" size={22} color={colors.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={colors.muted}>Demande · 2 dernières heures</AppText>
          <AppText variant="h2" style={{ marginTop: 1 }}>Zones chaudes</AppText>
        </View>
        <Pressable
          onPress={() => { setLoading(true); void load(); }}
          hitSlop={10}
          style={{
            width: 44, height: 44, borderRadius: radius.md,
            backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadow.card,
          }}
        >
          <Icon name="refresh" size={20} color={colors.ember} />
        </Pressable>
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
              pinColor="#D6452F"
            />
          ))}
          {/* Active road reports — sand, accidents, police checkpoints, etc. */}
          <RoadReportMarkers reports={reports} />
        </MapView>

        {loading && cells.length === 0 ? (
          <View style={{
            position: 'absolute', top: spacing.base, alignSelf: 'center',
            backgroundColor: colors.espresso, borderRadius: radius.pill,
            paddingHorizontal: spacing.base, paddingVertical: spacing.sm,
            flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
          }}>
            <ActivityIndicator color={colors.saffron} size="small" />
            <AppText variant="caption" color={colors.onEspresso}>Chargement…</AppText>
          </View>
        ) : null}

        {!loading && cells.length === 0 ? (
          <View style={{
            position: 'absolute', top: spacing.base, left: spacing.base, right: spacing.base,
            backgroundColor: 'rgba(42, 26, 14, 0.92)', borderRadius: radius.md, padding: spacing.md,
          }}>
            <AppText variant="body" color={colors.onEspresso} align="center">
              Aucune zone chaude pour l'instant — pas assez de courses récentes.
            </AppText>
          </View>
        ) : null}

        {/* Floating "report a hazard" button — use captain GPS if known. */}
        <RoadReportButton at={myPos} onCreated={refreshReports} />

        {/* Legend */}
        {cells.length > 0 ? (
          <View style={{
            position: 'absolute', bottom: spacing.md, left: spacing.md,
            backgroundColor: 'rgba(255, 252, 246, 0.96)',
            borderRadius: radius.md, padding: spacing.sm + 2, gap: 6, ...shadow.card,
          }}>
            <LegendRow color="#D6452F" label="Très forte" />
            <LegendRow color="#F2682C" label="Moyenne" />
            <LegendRow color="#F6A623" label="Faible" />
          </View>
        ) : null}
      </View>

      {/* Top-3 list under the map for quick scanning */}
      {hottest.length > 0 ? (
        <View style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
          paddingHorizontal: spacing.base, paddingTop: spacing.base, paddingBottom: spacing.sm,
          ...shadow.raised,
        }}>
          <AppText variant="overline" color={colors.muted} style={{ marginBottom: spacing.xs }}>Top 3</AppText>
          {hottest.map((c, i) => (
            <Pressable
              key={`top-list-${i}`}
              onPress={() => flyToCluster(c)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: spacing.md,
                paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1,
              })}
            >
              <View style={{
                width: 30, height: 30, borderRadius: 15,
                backgroundColor: colorFor(c.score).stroke,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <AppText variant="label" color={colors.white}>{i + 1}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">
                  {c.rideCount} course{c.rideCount > 1 ? 's' : ''} demandée{c.rideCount > 1 ? 's' : ''}
                </AppText>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: 1 }}>
                  {c.cellCount > 1 ? `${c.cellCount} zones · ` : ''}Sur 2h · {c.centerLat.toFixed(4)}, {c.centerLng.toFixed(4)}
                </AppText>
              </View>
              <Icon name="chevron" size={20} color={colors.faint} />
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
      <AppText variant="caption" color={colors.ink2}>{label}</AppText>
    </View>
  );
}
