'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import { ReactNode, forwardRef } from 'react';
import MapboxMap, { MapRef, ViewStateChangeEvent, MapMouseEvent } from 'react-map-gl/mapbox';
import { MAPBOX_STYLE, MAPBOX_TOKEN } from '@/lib/env';

// Nouakchott city center — sensible default view for every admin map.
export const NKC_CENTER = { longitude: -15.9785, latitude: 18.0858 };
export const DEFAULT_ZOOM = 12;

interface Props {
  children?: ReactNode;
  /** Initial viewport. Uncontrolled — pan/zoom is owned by Mapbox after mount. */
  initialViewState?: {
    longitude: number;
    latitude: number;
    zoom: number;
  };
  onClick?: (e: MapMouseEvent) => void;
  onMove?: (e: ViewStateChangeEvent) => void;
  onLoad?: () => void;
  /** Extra class on the wrapper. The wrapper fills its parent by default. */
  className?: string;
}

/**
 * Shared map shell — applies the brand style, token, default Nouakchott
 * viewport, and a graceful fallback when no NEXT_PUBLIC_MAPBOX_TOKEN is set.
 * Wraps `react-map-gl/mapbox`; pass markers/popups/layers as children.
 */
export const MapShell = forwardRef<MapRef, Props>(function MapShell(
  { children, initialViewState, onClick, onMove, onLoad, className },
  ref,
) {
  if (!MAPBOX_TOKEN) {
    return (
      <div className="h-full w-full grid place-items-center bg-slate-100 p-6 text-center">
        <div className="max-w-sm">
          <div className="text-3xl mb-2">🗺️</div>
          <div className="font-medium text-slate-800">Carte indisponible</div>
          <p className="text-sm text-slate-500 mt-1">
            Définis NEXT_PUBLIC_MAPBOX_TOKEN pour activer la carte.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={className ?? 'h-full w-full'}>
      <MapboxMap
        ref={ref}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle={MAPBOX_STYLE}
        initialViewState={{
          longitude: initialViewState?.longitude ?? NKC_CENTER.longitude,
          latitude: initialViewState?.latitude ?? NKC_CENTER.latitude,
          zoom: initialViewState?.zoom ?? DEFAULT_ZOOM,
        }}
        onClick={onClick}
        onMove={onMove}
        onLoad={onLoad}
        attributionControl={true}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </MapboxMap>
    </div>
  );
});
