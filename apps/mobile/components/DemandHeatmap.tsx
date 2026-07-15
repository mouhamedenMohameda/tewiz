import { useMemo } from 'react';
import { getMapbox } from '@/lib/mapbox';

export interface DemandCell {
  centroid: { lat: number; lng: number };
  demandScore: number;
}

/**
 * The demand heatmap as a Mapbox GPU layer — same warm palette (yellow →
 * orange → red) as the dedicated /captain/heatmap screen, so the blobs read
 * identically wherever they appear. Must be rendered as a child of a MapView
 * (i.e. inside <MapShell>). Renders nothing when Mapbox isn't available.
 */
export function DemandHeatmap({ cells }: { cells: DemandCell[] }) {
  const M = getMapbox();

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: cells
      .filter((c) => c.demandScore >= 0.05)
      .map((c) => ({
        type: 'Feature',
        properties: { weight: c.demandScore },
        geometry: { type: 'Point', coordinates: [c.centroid.lng, c.centroid.lat] },
      })),
  }), [cells]);

  if (!M) return null;

  return (
    <M.ShapeSource id="home-demand-heatmap" shape={geojson}>
      <M.HeatmapLayer
        id="home-demand-heatmap-layer"
        sourceID="home-demand-heatmap"
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
    </M.ShapeSource>
  );
}
