'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { MapRef } from 'react-map-gl/mapbox';
import { Layer, Marker, Popup, Source } from 'react-map-gl/mapbox';
import { MapShell } from '@/components/Map';

export type TrackPoint = {
  lat: number;
  lng: number;
  /** ISO timestamp of the fix — used for replay + duration. */
  recordedAt?: string;
  speedMps?: number | null;
};

export type CaptainMarker = {
  id: string;
  fullName: string | null;
  phone: string;
  presence: 'offline' | 'online' | 'on_ride' | 'paused';
  lat: number | null;
  lng: number | null;
  last_seen?: string | null;
};

interface Props {
  captains: CaptainMarker[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Off-ride breadcrumb trail of the selected captain, drawn as a polyline. */
  track?: TrackPoint[];
  /**
   * Replay cursor: index into `track` up to which the path is "traveled".
   * When null, the whole path is drawn at full strength (no replay running).
   */
  replayIndex?: number | null;
}

export function CaptainsMap({ captains, selectedId, onSelect, track, replayIndex }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const fittedRef = useRef(false);
  const [popupId, setPopupId] = useState<string | null>(null);

  const visible = captains.filter((c) => c.lat != null && c.lng != null);

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

  // Pan to selected captain — ONCE per selection, not on every render.
  //
  // `visible` is a fresh array on each render (plain .filter), and the page
  // re-renders often: every 10 s refetch AND every 350 ms while a trail replay
  // is playing. Depending on `visible` here re-ran the flyTo on each of those
  // renders, yanking the map back to the captain and making it impossible to
  // zoom out or pan during playback. Guard on the captain id we last flew to so
  // we only recenter when the *selection itself* changes.
  const flownToRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) {
      if (!selectedId) flownToRef.current = null;
      return;
    }
    if (flownToRef.current === selectedId) return;
    const c = visible.find((x) => x.id === selectedId);
    if (!c) return; // coords not loaded yet — retry on next render
    flownToRef.current = selectedId;
    const currentZoom = map.getZoom();
    map.flyTo({
      center: [c.lng!, c.lat!],
      zoom: currentZoom < 14 ? 14 : currentZoom,
    });
  }, [selectedId, visible]);

  // Fit the whole trail into view — once per selection. Keyed on the trail's
  // START point (stable across the 15 s refetch of the same captain), so the
  // map doesn't jump every time a new tail point arrives.
  const trackFitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!track || track.length < 2) {
      if (!track || track.length === 0) trackFitKeyRef.current = null;
      return;
    }
    const key = `${track[0]!.lat},${track[0]!.lng}`;
    if (!map || trackFitKeyRef.current === key) return;
    trackFitKeyRef.current = key;

    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const p of track) {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 90, duration: 500, maxZoom: 16 },
    );
  }, [track]);

  const handleMarkerClick = useCallback(
    (id: string) => {
      setPopupId(id);
      onSelect(id);
    },
    [onSelect],
  );

  const popupCaptain = popupId ? visible.find((c) => c.id === popupId) : null;

  const hasTrail = !!track && track.length >= 2;
  const replaying = hasTrail && replayIndex != null;

  // GeoJSON LineString for the full trail (needs ≥2 points).
  const trackGeoJson = useMemo(
    () =>
      hasTrail
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: track!.map((p) => [p.lng, p.lat]),
            },
          }
        : null,
    [hasTrail, track],
  );

  // The "already traveled" slice while a replay cursor is active.
  const traveledGeoJson = useMemo(() => {
    if (!replaying) return null;
    const idx = Math.min(replayIndex!, track!.length - 1);
    if (idx < 1) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: track!.slice(0, idx + 1).map((p) => [p.lng, p.lat]),
      },
    };
  }, [replaying, replayIndex, track]);

  const start = hasTrail ? track![0]! : null;
  const end = hasTrail ? track![track!.length - 1]! : null;
  const cursor =
    replaying ? track![Math.min(replayIndex!, track!.length - 1)]! : null;

  return (
    <MapShell ref={mapRef}>
      {trackGeoJson && (
        <Source id="captain-track" type="geojson" data={trackGeoJson}>
          <Layer
            id="captain-track-line"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{
              'line-color': '#f97316',
              'line-width': 4,
              // Dim the full path when replaying so the traveled slice stands out.
              'line-opacity': replaying ? 0.28 : 0.85,
            }}
          />
        </Source>
      )}
      {traveledGeoJson && (
        <Source id="captain-track-traveled" type="geojson" data={traveledGeoJson}>
          <Layer
            id="captain-track-traveled-line"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': '#ea580c', 'line-width': 5, 'line-opacity': 0.95 }}
          />
        </Source>
      )}

      {/* Trail start / end endpoints. */}
      {start && (
        <Marker longitude={start.lng} latitude={start.lat} anchor="center">
          <Endpoint color="#16a34a" title="Départ" />
        </Marker>
      )}
      {end && !replaying && (
        <Marker longitude={end.lng} latitude={end.lat} anchor="center">
          <Endpoint color="#dc2626" title="Fin du trajet" ring />
        </Marker>
      )}
      {/* Moving replay head. */}
      {cursor && (
        <Marker longitude={cursor.lng} latitude={cursor.lat} anchor="center">
          <Endpoint color="#ea580c" title="Position" ring pulse />
        </Marker>
      )}

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
          <Pin color={presenceColor(c.presence)} dim={c.presence === 'offline'} />
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
            {popupCaptain.presence === 'offline' && popupCaptain.last_seen && (
              <div style={{ marginTop: 2, color: '#64748b', fontSize: 12 }}>
                Dernière connexion {formatLastSeen(popupCaptain.last_seen)}
              </div>
            )}
          </div>
        </Popup>
      )}
    </MapShell>
  );
}

function presenceColor(p: CaptainMarker['presence']): string {
  if (p === 'on_ride') return '#f97316';
  if (p === 'paused') return '#64748b';
  if (p === 'offline') return '#94a3b8';
  return '#16a34a';
}

function presenceLabel(p: CaptainMarker['presence']): string {
  if (p === 'on_ride') return '🚖 En course';
  if (p === 'paused') return '⏸️ En pause';
  if (p === 'online') return '🟢 En ligne';
  return '⚫ Hors ligne';
}

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `il y a ${days} j`;
  return `le ${d.toLocaleDateString('fr-FR')}`;
}

/** Small circular endpoint marker for the trail (start / end / replay head). */
function Endpoint({
  color,
  title,
  ring,
  pulse,
}: {
  color: string;
  title: string;
  ring?: boolean;
  pulse?: boolean;
}) {
  return (
    <div
      title={title}
      style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: color,
        border: '2.5px solid #fff',
        boxShadow: ring
          ? `0 0 0 4px ${color}33, 0 1px 3px rgba(0,0,0,0.4)`
          : '0 1px 3px rgba(0,0,0,0.4)',
        animation: pulse ? 'trackpulse 1.4s ease-out infinite' : undefined,
      }}
    >
      {pulse && (
        <style>{`@keyframes trackpulse{0%{box-shadow:0 0 0 0 ${color}66}70%{box-shadow:0 0 0 10px ${color}00}100%{box-shadow:0 0 0 0 ${color}00}}`}</style>
      )}
    </div>
  );
}

function Pin({ color, label, dim }: { color: string; label?: string; dim?: boolean }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 26,
        height: 36,
        cursor: 'pointer',
        opacity: dim ? 0.55 : 1,
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
