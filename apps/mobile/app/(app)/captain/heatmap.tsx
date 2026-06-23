import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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

// Snap-style heat blob: thin concentric rings of low alpha stacked
// outer→inner. Alpha accumulates toward the centre into a smooth radial
// fade. Snap's palette is warm-only (faint yellow halo → orange → red core)
// — no cool tones, despite some thermal-map references.
const BLOB_RING_COUNT = 10;
const BLOB_OUTER_M = 350;   // soft halo edge
const BLOB_INNER_M = 12;    // hot dot
const BLOB_RING_ALPHA = 0.06;

// Cap how many cells we paint per frame. ~1000 demo rides produce 100+ cells;
// drawing all of them with 10 rings each (~1000 Circles) tanks Apple Maps.
// 80 cells × 10 = 800 Circles, smooth on iOS.
const MAX_VISIBLE_CELLS = 80;

// Quadratic ease packs rings near the centre — bright core, gentle halo.
const BLOB_RING_RADII: number[] = Array.from(
  { length: BLOB_RING_COUNT },
  (_, i) => {
    const t = i / (BLOB_RING_COUNT - 1);
    const ease = t * t;
    return BLOB_OUTER_M - (BLOB_OUTER_M - BLOB_INNER_M) * ease;
  },
);

// Warm palette stops (outer → inner). RGB only; alpha applied at render.
const WARM_STOPS: Array<[number, [number, number, number]]> = [
  [0.00, [255, 230, 130]],   // soft yellow halo
  [0.45, [255, 165, 50]],    // orange
  [0.80, [232, 70, 30]],     // bright red
  [1.00, [180, 24, 18]],     // deep red core
];

function accentFor(score: number): string {
  if (score >= 0.66) return '#B41812';
  if (score >= 0.33) return '#E84620';
  return '#FFA532';
}

/**
 * Warm gradient colour for ring index `i`. Hotter cells reach further into
 * the deep-red end; cooler cells top out at orange.
 */
function ringColor(score: number, ringIdx: number): string {
  const t = (ringIdx / (BLOB_RING_COUNT - 1)) * (0.55 + 0.45 * score);

  let from = WARM_STOPS[0]!, to = WARM_STOPS[WARM_STOPS.length - 1]!;
  for (let i = 0; i < WARM_STOPS.length - 1; i++) {
    if (t >= WARM_STOPS[i]![0] && t <= WARM_STOPS[i + 1]![0]) {
      from = WARM_STOPS[i]!;
      to = WARM_STOPS[i + 1]!;
      break;
    }
  }
  const span = to[0] - from[0];
  const local = span === 0 ? 0 : (t - from[0]) / span;
  const r = Math.round(from[1][0] + (to[1][0] - from[1][0]) * local);
  const g = Math.round(from[1][1] + (to[1][1] - from[1][1]) * local);
  const b = Math.round(from[1][2] + (to[1][2] - from[1][2]) * local);
  return `rgba(${r}, ${g}, ${b}, ${BLOB_RING_ALPHA})`;
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
  const { t } = useTranslation();
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

  // Top-3 list groups cells within ~800 m so adjacent activity reads as one
  // zone in the side list. The map itself ignores clustering — every cell
  // paints its own gradient blob, and overlapping blobs blend additively.
  const clusters = clusterCells(cells, 800);
  const hottest = [...clusters].sort((a, b) => b.score - a.score).slice(0, 3);
  // Cut noise + cap to top N hottest cells so the map stays smooth on iOS.
  // Apple Maps degrades sharply past ~1000 Circle overlays; 80 cells × 10
  // rings ≈ 800 Circles is the sweet spot.
  const visibleCells = cells
    .filter((c) => c.demandScore >= 0.10)
    .sort((a, b) => b.demandScore - a.demandScore)
    .slice(0, MAX_VISIBLE_CELLS);

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
          <AppText variant="overline" color={colors.muted}>{t('captain.heatmap.overline')}</AppText>
          <AppText variant="h2" style={{ marginTop: 1 }}>{t('captain.heatmap.title')}</AppText>
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
          {/* Snap-style heat blobs — many thin concentric rings per cell
              with constant low alpha so they accumulate into a smooth radial
              gradient with no visible bands. */}
          {visibleCells.flatMap((cell) => {
            const center = { latitude: cell.centroid.lat, longitude: cell.centroid.lng };
            return BLOB_RING_RADII.map((r, ring) => (
              <Circle
                key={`${cell.h3Index}-${ring}`}
                center={center}
                radius={r}
                fillColor={ringColor(cell.demandScore, ring)}
                strokeColor="rgba(0,0,0,0)"
                strokeWidth={0}
              />
            ));
          })}
          {/* Tap-able markers on top-3 clusters so the captain can identify them */}
          {hottest.map((c, i) => (
            <Marker
              key={`top-${i}`}
              coordinate={{ latitude: c.centerLat, longitude: c.centerLng }}
              title={t('captain.heatmap.topClusterTitle', { rank: i + 1, count: c.rideCount })}
              description={c.cellCount > 1
                ? t('captain.heatmap.zonesMerged', { count: c.cellCount })
                : t('captain.heatmap.twoHours')}
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
            <AppText variant="caption" color={colors.onEspresso}>{t('captain.heatmap.loading')}</AppText>
          </View>
        ) : null}

        {!loading && cells.length === 0 ? (
          <View style={{
            position: 'absolute', top: spacing.base, left: spacing.base, right: spacing.base,
            backgroundColor: 'rgba(42, 26, 14, 0.92)', borderRadius: radius.md, padding: spacing.md,
          }}>
            <AppText variant="body" color={colors.onEspresso} align="center">
              {t('captain.heatmap.emptyOverlay')}
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
            <LegendRow color="#B41812" label={t('captain.heatmap.legendHigh')} />
            <LegendRow color="#E84620" label={t('captain.heatmap.legendMid')} />
            <LegendRow color="#FFA532" label={t('captain.heatmap.legendLow')} />
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
          <AppText variant="overline" color={colors.muted} style={{ marginBottom: spacing.xs }}>{t('captain.heatmap.top3')}</AppText>
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
                backgroundColor: accentFor(c.score),
                alignItems: 'center', justifyContent: 'center',
              }}>
                <AppText variant="label" color={colors.white}>{i + 1}</AppText>
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">
                  {c.rideCount > 1
                    ? t('captain.heatmap.rideMany', { count: c.rideCount })
                    : t('captain.heatmap.rideOne', { count: c.rideCount })}
                </AppText>
                <AppText variant="caption" color={colors.muted} style={{ marginTop: 1 }}>
                  {c.cellCount > 1 ? t('captain.heatmap.zonesPrefix', { count: c.cellCount }) : ''}{t('captain.heatmap.twoHours')} · {c.centerLat.toFixed(4)}, {c.centerLng.toFixed(4)}
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
