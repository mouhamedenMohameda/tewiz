import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import Mapbox from '@rnmapbox/maps';
import * as Location from 'expo-location';
import { api } from '@/lib/api';
import { usePolling } from '@/lib/usePolling';
import { MapShell } from '@/components/MapShell';
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
const FALLBACK_CENTER: [number, number] = [-15.9785, 18.0853];
const FALLBACK_ZOOM = 11;

function accentFor(score: number): string {
  if (score >= 0.66) return '#B41812';
  if (score >= 0.33) return '#E84620';
  return '#FFA532';
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
 * Greedy clustering used only for the side list: collapse cells within
 * `mergeRadiusM` of each other into a single zone so adjacent activity reads
 * as one entry. The map renders every cell individually through the heatmap
 * layer — no clustering needed at draw time.
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
  const cameraRef = useRef<Mapbox.Camera>(null);
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
        cameraRef.current?.setCamera({
          centerCoordinate: [p.lng, p.lat],
          zoomLevel: 12,
          animationDuration: 500,
        });
      } catch {}
    })();
  }, []);

  const clusters = clusterCells(cells, 800);
  const hottest = [...clusters].sort((a, b) => b.score - a.score).slice(0, 3);

  // Feed every cell whose score is non-trivial into the heatmap layer. The
  // GPU handles thousands of points easily, so no MAX_VISIBLE_CELLS cap.
  const heatmapGeoJson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: cells
      .filter((c) => c.demandScore >= 0.05)
      .map((c) => ({
        type: 'Feature',
        properties: { weight: c.demandScore },
        geometry: { type: 'Point', coordinates: [c.centroid.lng, c.centroid.lat] },
      })),
  }), [cells]);

  function flyToCluster(c: Cluster) {
    cameraRef.current?.setCamera({
      centerCoordinate: [c.centerLng, c.centerLat],
      zoomLevel: 13,
      animationDuration: 500,
    });
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
        <MapShell
          cameraRef={cameraRef}
          centerCoordinate={FALLBACK_CENTER}
          zoomLevel={FALLBACK_ZOOM}
          showsUserLocation
        >
          {/* GPU heatmap — warm palette (yellow → orange → red) matching the
              previous Snap-style blobs. Radius & intensity scale with zoom so
              the heat reads at city zoom (~11) and street zoom (~16) alike. */}
          <Mapbox.ShapeSource id="demand-heatmap" shape={heatmapGeoJson}>
            <Mapbox.HeatmapLayer
              id="demand-heatmap-layer"
              sourceID="demand-heatmap"
              style={{
                heatmapWeight: ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1, 1],
                heatmapIntensity: ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 2.2],
                heatmapRadius: ['interpolate', ['linear'], ['zoom'], 10, 18, 15, 55],
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0, 'rgba(255, 230, 130, 0)',
                  0.2, 'rgba(255, 230, 130, 0.55)',
                  0.45, 'rgba(255, 165, 50, 0.75)',
                  0.8, 'rgba(232, 70, 30, 0.85)',
                  1, 'rgba(180, 24, 18, 0.95)',
                ],
                heatmapOpacity: ['interpolate', ['linear'], ['zoom'], 10, 0.85, 16, 0.6],
              }}
            />
          </Mapbox.ShapeSource>

          {/* Tap-able markers on top-3 clusters so the captain can identify them */}
          {hottest.map((c, i) => (
            <Mapbox.PointAnnotation
              key={`top-${i}`}
              id={`top-${i}`}
              coordinate={[c.centerLng, c.centerLat]}
              title={t('captain.heatmap.topClusterTitle', { rank: i + 1, count: c.rideCount })}
            >
              <View style={{
                width: 30, height: 30, borderRadius: 15,
                backgroundColor: accentFor(c.score),
                borderWidth: 2, borderColor: '#fff',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <AppText variant="label" color={colors.white}>{String(i + 1)}</AppText>
              </View>
            </Mapbox.PointAnnotation>
          ))}

          {/* Active road reports — sand, accidents, police checkpoints, etc. */}
          <RoadReportMarkers reports={reports} />
        </MapShell>

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
