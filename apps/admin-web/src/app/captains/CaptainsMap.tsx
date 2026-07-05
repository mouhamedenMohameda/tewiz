'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';
import { Marker, Popup } from 'react-map-gl/mapbox';
import { MapShell } from '@/components/Map';

export type CaptainMarker = {
  id: string;
  fullName: string | null;
  phone: string;
  presence: 'offline' | 'online' | 'on_ride' | 'paused';
  lat: number | null;
  lng: number | null;
};

interface Props {
  captains: CaptainMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CaptainsMap({ captains, selectedId, onSelect }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const fittedRef = useRef(false);
  const [popupId, setPopupId] = useState<string | null>(null);

  const visible = captains.filter(
    (c) =>
      c.lat != null &&
      c.lng != null &&
      (c.presence === 'online' || c.presence === 'on_ride' || c.presence === 'paused'),
  );

  // Fit bounds the first time we have any markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fittedRef.current || visible.length === 0) return;
    if (visible.length === 1) {
      map.flyTo({ center: [visible[0]!.lng!, visible[0]!.lat!], zoom: 14 });
    } else {
      let minLng = Infinity,
        minLat = Infinity,
        maxLng = -Infinity,
        maxLat = -Infinity;
      for (const c of visible) {
        minLng = Math.min(minLng, c.lng!);
        maxLng = Math.max(maxLng, c.lng!);
        minLat = Math.min(minLat, c.lat!);
        maxLat = Math.max(maxLat, c.lat!);
      }
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 80, duration: 400 },
      );
    }
    fittedRef.current = true;
  }, [visible]);

  // Pan to selected captain.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const c = visible.find((x) => x.id === selectedId);
    if (!c) return;
    const currentZoom = map.getZoom();
    map.flyTo({
      center: [c.lng!, c.lat!],
      zoom: currentZoom < 14 ? 14 : currentZoom,
    });
  }, [selectedId, visible]);

  const handleMarkerClick = useCallback(
    (id: string) => {
      setPopupId(id);
      onSelect(id);
    },
    [onSelect],
  );

  const popupCaptain = popupId ? visible.find((c) => c.id === popupId) : null;

  return (
    <MapShell ref={mapRef}>
      {visible.map((c) => (
        <Marker
          key={c.id}
          longitude={c.lng!}
          latitude={c.lat!}
          anchor="bottom"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            handleMarkerClick(c.id);
          }}
        >
          <Pin color={presenceColor(c.presence)} />
        </Marker>
      ))}
      {popupCaptain && (
        <Popup
          longitude={popupCaptain.lng!}
          latitude={popupCaptain.lat!}
          anchor="bottom"
          offset={28}
          onClose={() => setPopupId(null)}
          closeOnClick={false}
        >
          <div style={{ fontFamily: 'Sora', fontSize: 13 }}>
            <div style={{ fontWeight: 600 }}>{popupCaptain.fullName ?? '—'}</div>
            <div style={{ color: '#64748b' }}>{popupCaptain.phone}</div>
            <div style={{ marginTop: 4 }}>{presenceLabel(popupCaptain.presence)}</div>
          </div>
        </Popup>
      )}
    </MapShell>
  );
}

function presenceColor(p: CaptainMarker['presence']): string {
  if (p === 'on_ride') return '#f97316';
  if (p === 'paused') return '#64748b';
  return '#16a34a';
}

function presenceLabel(p: CaptainMarker['presence']): string {
  if (p === 'on_ride') return '🚖 En course';
  if (p === 'paused') return '⏸️ En pause';
  if (p === 'online') return '🟢 En ligne';
  return '⚫ Hors ligne';
}

function Pin({ color, label }: { color: string; label?: string }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 26,
        height: 36,
        cursor: 'pointer',
        filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))',
      }}
    >
      <svg
        width="26"
        height="36"
        viewBox="0 0 26 36"
        fill={color}
        stroke="#fff"
        strokeWidth="2"
      >
        <path d="M13 0C6.4 0 1 5.4 1 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z" />
      </svg>
      {label && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 0,
            width: 26,
            textAlign: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
