import { forwardRef, ReactNode, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { initMapbox, MAPBOX_STYLE_URL, MAPBOX_TOKEN, NKC_CENTER, DEFAULT_ZOOM } from '@/lib/mapbox';

interface Props {
  children?: ReactNode;
  /** [lng, lat] centre on first render. Defaults to Nouakchott. */
  centerCoordinate?: [number, number];
  zoomLevel?: number;
  showsUserLocation?: boolean;
  /** Tap on the map — receives [lng, lat]. */
  onPress?: (lngLat: [number, number]) => void;
  cameraRef?: React.RefObject<Mapbox.Camera | null>;
  style?: object;
}

/**
 * Shared map shell — sets the brand style + access token and renders a
 * graceful fallback when no EXPO_PUBLIC_MAPBOX_TOKEN is set so the screen
 * keeps working in development without crashing.
 */
export const MapShell = forwardRef<Mapbox.MapView, Props>(function MapShell(
  { children, centerCoordinate, zoomLevel, showsUserLocation, onPress, cameraRef, style },
  ref,
) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(initMapbox());
  }, []);

  if (!MAPBOX_TOKEN) {
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackEmoji}>🗺️</Text>
        <Text style={styles.fallbackTitle}>Carte indisponible</Text>
        <Text style={styles.fallbackBody}>
          Définis EXPO_PUBLIC_MAPBOX_TOKEN dans eas.json.
        </Text>
      </View>
    );
  }

  if (!ready) return <View style={[{ flex: 1 }, style]} />;

  return (
    <Mapbox.MapView
      ref={ref}
      style={style ?? { flex: 1 }}
      styleURL={MAPBOX_STYLE_URL}
      onPress={
        onPress
          ? (feature: GeoJSON.Feature) => {
              const coords = (feature.geometry as GeoJSON.Point | null)?.coordinates;
              if (coords && coords.length >= 2) {
                onPress([coords[0]!, coords[1]!]);
              }
            }
          : undefined
      }
      logoEnabled
      attributionEnabled
      compassEnabled={false}
      scaleBarEnabled={false}
    >
      <Mapbox.Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: centerCoordinate ?? NKC_CENTER,
          zoomLevel: zoomLevel ?? DEFAULT_ZOOM,
        }}
      />
      {showsUserLocation && <Mapbox.UserLocation visible animated />}
      {children}
    </Mapbox.MapView>
  );
});

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  fallbackEmoji: { fontSize: 32, marginBottom: 8 },
  fallbackTitle: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  fallbackBody: { fontSize: 13, color: '#64748b', marginTop: 4, textAlign: 'center' },
});
