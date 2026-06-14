'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import type { Pin, PinSide } from './types';

// Nouakchott city center — sensible default view.
const DEFAULT_CENTER = { lat: 18.0858, lng: -15.9785 };
const DEFAULT_ZOOM = 12;

interface Props {
  pickup: Pin | null;
  dropoff: Pin | null;
  activeSide: PinSide;
  /** Called when the dispatcher clicks the map or drags a marker. */
  onSet: (side: PinSide, lat: number, lng: number) => void;
}

export function VoiceRequestMap({ pickup, dropoff, activeSide, onSet }: Props) {
  const status = useGoogleMaps();
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const pickupMarker = useRef<any>(null);
  const dropoffMarker = useRef<any>(null);
  // Keep the latest activeSide/onSet for the (once-bound) map click listener.
  const activeSideRef = useRef<PinSide>(activeSide);
  const onSetRef = useRef(onSet);
  activeSideRef.current = activeSide;
  onSetRef.current = onSet;

  // Init the map once the script is ready.
  useEffect(() => {
    if (status !== 'ready' || !divRef.current || mapRef.current) return;
    const g = (window as any).google;
    const map = new g.maps.Map(divRef.current, {
      center: pickup ?? dropoff ?? DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      disableDefaultUI: false,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    });
    map.addListener('click', (e: any) => {
      if (!e.latLng) return;
      onSetRef.current(activeSideRef.current, e.latLng.lat(), e.latLng.lng());
    });
    mapRef.current = map;
  }, [status, pickup, dropoff]);

  // Sync the pickup marker.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const g = (window as any).google;
    if (!pickup) {
      pickupMarker.current?.setMap(null);
      pickupMarker.current = null;
      return;
    }
    if (!pickupMarker.current) {
      pickupMarker.current = new g.maps.Marker({
        map: mapRef.current,
        draggable: true,
        label: { text: 'A', color: '#fff', fontWeight: 'bold' },
        title: 'Départ',
        icon: coloredPin(g, '#16a34a'),
      });
      pickupMarker.current.addListener('dragend', (e: any) => {
        if (e.latLng) onSetRef.current('pickup', e.latLng.lat(), e.latLng.lng());
      });
    }
    pickupMarker.current.setPosition({ lat: pickup.lat, lng: pickup.lng });
  }, [status, pickup]);

  // Sync the dropoff marker.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const g = (window as any).google;
    if (!dropoff) {
      dropoffMarker.current?.setMap(null);
      dropoffMarker.current = null;
      return;
    }
    if (!dropoffMarker.current) {
      dropoffMarker.current = new g.maps.Marker({
        map: mapRef.current,
        draggable: true,
        label: { text: 'B', color: '#fff', fontWeight: 'bold' },
        title: 'Destination',
        icon: coloredPin(g, '#dc2626'),
      });
      dropoffMarker.current.addListener('dragend', (e: any) => {
        if (e.latLng) onSetRef.current('dropoff', e.latLng.lat(), e.latLng.lng());
      });
    }
    dropoffMarker.current.setPosition({ lat: dropoff.lat, lng: dropoff.lng });
  }, [status, dropoff]);

  // Keep both pins in view when both are set.
  useEffect(() => {
    if (status !== 'ready' || !mapRef.current) return;
    const g = (window as any).google;
    if (pickup && dropoff) {
      const bounds = new g.maps.LatLngBounds();
      bounds.extend({ lat: pickup.lat, lng: pickup.lng });
      bounds.extend({ lat: dropoff.lat, lng: dropoff.lng });
      mapRef.current.fitBounds(bounds, 80);
    } else if (pickup || dropoff) {
      mapRef.current.panTo(pickup ?? dropoff);
    }
  }, [status, pickup, dropoff]);

  if (status === 'no-key') {
    return (
      <MapFallback
        title="Carte indisponible"
        body="Définis NEXT_PUBLIC_GOOGLE_MAPS_API_KEY pour activer Google Maps. La recherche de lieux et la saisie manuelle restent disponibles."
      />
    );
  }
  if (status === 'error') {
    return (
      <MapFallback
        title="Échec du chargement de la carte"
        body="Impossible de charger Google Maps (clé invalide ou réseau). Utilise la recherche de lieux."
      />
    );
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

function coloredPin(g: any, color: string) {
  return {
    path: 'M12 0C7 0 3 4 3 9c0 6.6 9 15 9 15s9-8.4 9-15c0-5-4-9-9-9z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 1.6,
    anchor: new g.maps.Point(12, 24),
    labelOrigin: new g.maps.Point(12, 9),
  };
}

function MapFallback({ title, body }: { title: string; body: string }) {
  return (
    <div className="h-full w-full grid place-items-center bg-slate-100 p-6 text-center">
      <div className="max-w-sm">
        <div className="text-3xl mb-2">🗺️</div>
        <div className="font-medium text-slate-800">{title}</div>
        <p className="text-sm text-slate-500 mt-1">{body}</p>
      </div>
    </div>
  );
}
