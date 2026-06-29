'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { MapRef, MarkerDragEvent } from 'react-map-gl/mapbox';
import { Marker } from 'react-map-gl/mapbox';
import { MapShell } from '@/components/Map';
import type { Pin, PinSide } from './types';

interface Props {
  pickup: Pin | null;
  dropoff: Pin | null;
  activeSide: PinSide;
  /** Called when the dispatcher clicks the map or drags a marker. */
  onSet: (side: PinSide, lat: number, lng: number) => void;
}

export function VoiceRequestMap({ pickup, dropoff, activeSide, onSet }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  // Keep latest activeSide for the click handler closure.
  const activeSideRef = useRef<PinSide>(activeSide);
  activeSideRef.current = activeSide;

  const handleClick = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      onSet(activeSideRef.current, e.lngLat.lat, e.lngLat.lng);
    },
    [onSet],
  );

  const handlePickupDrag = useCallback(
    (e: MarkerDragEvent) => onSet('pickup', e.lngLat.lat, e.lngLat.lng),
    [onSet],
  );
  const handleDropoffDrag = useCallback(
    (e: MarkerDragEvent) => onSet('dropoff', e.lngLat.lat, e.lngLat.lng),
    [onSet],
  );

  // Keep both pins in view when both are set; pan to the lone pin otherwise.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pickup && dropoff) {
      map.fitBounds(
        [
          [Math.min(pickup.lng, dropoff.lng), Math.min(pickup.lat, dropoff.lat)],
          [Math.max(pickup.lng, dropoff.lng), Math.max(pickup.lat, dropoff.lat)],
        ],
        { padding: 80, duration: 400 },
      );
    } else if (pickup) {
      map.flyTo({ center: [pickup.lng, pickup.lat] });
    } else if (dropoff) {
      map.flyTo({ center: [dropoff.lng, dropoff.lat] });
    }
  }, [pickup, dropoff]);

  return (
    <MapShell
      ref={mapRef}
      onClick={handleClick}
      initialViewState={{
        longitude: pickup?.lng ?? dropoff?.lng ?? -15.9785,
        latitude: pickup?.lat ?? dropoff?.lat ?? 18.0858,
        zoom: 12,
      }}
    >
      {pickup && (
        <Marker
          longitude={pickup.lng}
          latitude={pickup.lat}
          anchor="bottom"
          draggable
          onDragEnd={handlePickupDrag}
        >
          <LabeledPin color="#16a34a" label="A" />
        </Marker>
      )}
      {dropoff && (
        <Marker
          longitude={dropoff.lng}
          latitude={dropoff.lat}
          anchor="bottom"
          draggable
          onDragEnd={handleDropoffDrag}
        >
          <LabeledPin color="#dc2626" label="B" />
        </Marker>
      )}
    </MapShell>
  );
}

function LabeledPin({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 28,
        height: 38,
        cursor: 'grab',
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
      }}
    >
      <svg width="28" height="38" viewBox="0 0 26 36" fill={color} stroke="#fff" strokeWidth="2">
        <path d="M13 0C6.4 0 1 5.4 1 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z" />
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: 0,
          width: 28,
          textAlign: 'center',
          color: '#fff',
          fontWeight: 700,
          fontSize: 13,
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </div>
  );
}
