'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

// Nouakchott city center — sensible default view.
const DEFAULT_CENTER = { lat: 18.0858, lng: -15.9785 };
const DEFAULT_ZOOM = 12;

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
  const status = useGoogleMaps();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const infoRef = useRef<any>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fittedRef = useRef(false);
  const [failed, setFailed] = useState(false);

  // Init the map once.
  useEffect(() => {
    if (status !== 'ready' || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    if (typeof g?.maps?.Map !== 'function') {
      setFailed(true);
      return;
    }
    try {
      mapRef.current = new g.maps.Map(divRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        disableDefaultUI: false,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      infoRef.current = new g.maps.InfoWindow();
    } catch {
      setFailed(true);
    }
  }, [status]);

  // Sync markers when the captains list changes.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const g = (window as any).google;

    const onMap = new Set<string>();
    for (const c of captains) {
      if (c.lat == null || c.lng == null) continue;
      if (c.presence !== 'online' && c.presence !== 'on_ride' && c.presence !== 'paused') continue;
      onMap.add(c.id);

      const existing = markersRef.current.get(c.id);
      const pos = { lat: c.lat, lng: c.lng };
      const icon = coloredPin(g, presenceColor(c.presence));
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(icon);
      } else {
        const m = new g.maps.Marker({
          map: mapRef.current,
          position: pos,
          title: c.fullName ?? c.phone,
          icon,
        });
        m.addListener('click', () => {
          infoRef.current?.setContent(
            `<div style="font-family:system-ui;font-size:13px">
               <div style="font-weight:600">${escapeHtml(c.fullName ?? '—')}</div>
               <div style="color:#64748b">${escapeHtml(c.phone)}</div>
               <div style="margin-top:4px">${presenceLabel(c.presence)}</div>
             </div>`,
          );
          infoRef.current?.open({ map: mapRef.current, anchor: m });
          onSelectRef.current(c.id);
        });
        markersRef.current.set(c.id, m);
      }
    }

    // Remove stale markers.
    for (const [id, m] of markersRef.current) {
      if (!onMap.has(id)) {
        m.setMap(null);
        markersRef.current.delete(id);
      }
    }

    // First time we have any markers, fit bounds.
    if (!fittedRef.current && onMap.size > 0) {
      const bounds = new g.maps.LatLngBounds();
      for (const id of onMap) {
        const m = markersRef.current.get(id);
        if (m) bounds.extend(m.getPosition());
      }
      if (onMap.size === 1) {
        mapRef.current.panTo(bounds.getCenter());
        mapRef.current.setZoom(14);
      } else {
        mapRef.current.fitBounds(bounds, 80);
      }
      fittedRef.current = true;
    }
  }, [status, captains]);

  // Pan to selected captain.
  useEffect(() => {
    if (!selectedId || status !== 'ready' || !mapRef.current) return;
    const m = markersRef.current.get(selectedId);
    if (!m) return;
    mapRef.current.panTo(m.getPosition());
    if ((mapRef.current.getZoom() ?? 0) < 14) mapRef.current.setZoom(14);
  }, [selectedId, status]);

  if (status === 'no-key') {
    return <MapFallback body="Définis NEXT_PUBLIC_GOOGLE_MAPS_API_KEY pour activer la carte." />;
  }
  if (status === 'error' || failed) {
    return <MapFallback body="Google Maps n’a pas pu se charger." />;
  }

  return (
    <div className="relative h-full w-full">
      <div ref={divRef} className="h-full w-full" />
      {status === 'loading' && (
        <div className="absolute inset-0 grid place-items-center bg-slate-50 text-sm text-slate-500">
          Chargement de la carte…
        </div>
      )}
    </div>
  );
}

function presenceColor(p: CaptainMarker['presence']): string {
  if (p === 'on_ride') return '#f97316'; // orange
  if (p === 'paused') return '#64748b';  // slate
  return '#16a34a'; // green = online
}

function presenceLabel(p: CaptainMarker['presence']): string {
  if (p === 'on_ride') return '🚖 En course';
  if (p === 'paused') return '⏸️ En pause';
  if (p === 'online') return '🟢 En ligne';
  return '⚫ Hors ligne';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

function coloredPin(g: any, color: string) {
  return {
    path: 'M12 0C7 0 3 4 3 9c0 6.6 9 15 9 15s9-8.4 9-15c0-5-4-9-9-9z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 1.6,
    anchor: new g.maps.Point(12, 24),
  };
}

function MapFallback({ body }: { body: string }) {
  return (
    <div className="h-full w-full grid place-items-center bg-slate-100 p-6 text-center">
      <div className="max-w-sm">
        <div className="text-3xl mb-2">🗺️</div>
        <div className="font-medium text-slate-800">Carte indisponible</div>
        <p className="text-sm text-slate-500 mt-1">{body}</p>
      </div>
    </div>
  );
}
