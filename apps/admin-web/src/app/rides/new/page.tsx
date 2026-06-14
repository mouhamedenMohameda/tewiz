'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import clsx from 'clsx';

// Nouakchott Tevragh Zeina
const DEFAULT_CENTER = { lng: -15.9785, lat: 18.0853 };
const PICKUP_COLOR = '#2d4fd6';
const DROPOFF_COLOR = '#dc2626';

interface GeoResult {
  id: string;
  label: string;
  name: string;
  lat: number;
  lng: number;
}
interface Place { lat: number; lng: number; label?: string }

declare global {
  interface Window {
    L?: any;
  }
}

type Field = 'pickup' | 'dropoff';

export default function NewRidePage() {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const dropoffMarkerRef = useRef<any>(null);

  const [mapReady, setMapReady] = useState(false);
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);

  const [editing, setEditing] = useState<Field | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [rideType, setRideType] = useState<'passenger' | 'colis'>('passenger');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. Load Leaflet from CDN + boot the map.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.L) {
        await new Promise<void>((resolve, reject) => {
          const css = document.createElement('link');
          css.rel = 'stylesheet';
          css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
          document.head.appendChild(css);
          const sc = document.createElement('script');
          sc.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          sc.onload = () => resolve();
          sc.onerror = () => reject(new Error('Leaflet load failed'));
          document.head.appendChild(sc);
        });
      }
      if (cancelled || !mapContainer.current) return;

      const L = window.L;
      const map = L.map(mapContainer.current).setView(
        [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
        12,
      );
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      mapRef.current = map;
      setMapReady(true);

      map.on('click', (e: any) => {
        const p = { lat: e.latlng.lat, lng: e.latlng.lng, label: 'Point sur la carte' };
        if (!pickupMarkerRef.current) {
          dropMarker('pickup', p);
          setPickup(p);
        } else if (!dropoffMarkerRef.current) {
          dropMarker('dropoff', p);
          setDropoff(p);
        } else {
          dropMarker('dropoff', p);
          setDropoff(p);
        }
      });
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  function makeColoredIcon(color: string) {
    const L = window.L;
    const html = `
      <span style="
        display:inline-block;
        width:24px;height:24px;
        border-radius:50% 50% 50% 0;
        background:${color};
        transform:rotate(-45deg);
        border:2px solid #fff;
        box-shadow:0 2px 4px rgba(0,0,0,0.3);
      "></span>`;
    return L.divIcon({
      html,
      className: 'tewiz-pin',
      iconSize: [24, 24],
      iconAnchor: [12, 24],
    });
  }

  function dropMarker(field: Field, p: Place) {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;
    const existing = field === 'pickup' ? pickupMarkerRef.current : dropoffMarkerRef.current;
    if (existing) existing.remove();
    const color = field === 'pickup' ? PICKUP_COLOR : DROPOFF_COLOR;
    const marker = L.marker([p.lat, p.lng], {
      draggable: true,
      icon: makeColoredIcon(color),
    }).addTo(map);
    marker.on('dragend', () => {
      const ll = marker.getLatLng();
      const next = { lat: ll.lat, lng: ll.lng, label: 'Point sur la carte' };
      if (field === 'pickup') setPickup(next);
      else setDropoff(next);
    });
    if (field === 'pickup') pickupMarkerRef.current = marker;
    else dropoffMarkerRef.current = marker;
  }

  function applyPlace(field: Field, p: Place) {
    const map = mapRef.current;
    if (!map) return;
    dropMarker(field, p);
    if (field === 'pickup') setPickup(p);
    else setDropoff(p);
    map.setView([p.lat, p.lng], 14);
  }

  // 2. Debounced geocoding search.
  useEffect(() => {
    if (!editing || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const map = mapRef.current;
        const center = map?.getCenter();
        const proximity = center
          ? `${center.lng},${center.lat}`
          : `${DEFAULT_CENTER.lng},${DEFAULT_CENTER.lat}`;
        const r = await api.get('/geocode/search', {
          params: { q: query.trim(), proximity },
        });
        setResults(r.data?.results ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [query, editing]);

  function pickResult(r: GeoResult) {
    if (!editing) return;
    applyPlace(editing, { lat: r.lat, lng: r.lng, label: r.label });
    setEditing(null);
    setQuery('');
    setResults([]);
  }

  // 3. Fare estimate.
  let estimateMru: number | null = null;
  let estimateKm: number | null = null;
  if (pickup && dropoff) {
    const km = (haversineMeters(pickup, dropoff) * 1.3) / 1000;
    estimateKm = km;
    estimateMru = Math.max(40, Math.round(20 + km * 30));
  }

  async function submit() {
    if (!pickup || !dropoff) {
      setErrorMsg('Sélectionnez départ et destination.');
      return;
    }
    if (!passengerName.trim() || !passengerPhone.trim()) {
      setErrorMsg('Nom et téléphone du passager requis.');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const r = await api.post('/admin/rides', {
        pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
        rideType,
        passengerName: passengerName.trim(),
        passengerPhone: passengerPhone.trim(),
      });
      router.push(`/rides/${r.data.id}`);
    } catch (e: any) {
      const err = e.response?.data?.error;
      const detail = err?.issues?.[0]
        ? `${err.issues[0].path?.join('.') ?? ''}: ${err.issues[0].message}`
        : null;
      setErrorMsg(detail ?? err?.message ?? 'Création échouée.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Nouvelle course</h1>
        <p className="text-sm text-slate-500 mb-6">
          Réservez pour un client qui a appelé par téléphone. La course part directement
          à la recherche d'un chauffeur. Notez le code de vérification (affiché après création)
          et lisez-le au passager : il l'utilisera pour confirmer son identité au chauffeur.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
          {/* Left column: form */}
          <div className="card p-5 space-y-4">
            <AddressField
              color={PICKUP_COLOR}
              label="Départ"
              place={pickup}
              active={editing === 'pickup'}
              value={editing === 'pickup' ? query : (pickup?.label ?? '')}
              placeholder="Lieu de départ"
              onFocus={() => { setEditing('pickup'); setQuery(pickup?.label ?? ''); }}
              onChange={setQuery}
              onClear={() => {
                pickupMarkerRef.current?.remove();
                pickupMarkerRef.current = null;
                setPickup(null);
              }}
            />
            <AddressField
              color={DROPOFF_COLOR}
              label="Destination"
              place={dropoff}
              active={editing === 'dropoff'}
              value={editing === 'dropoff' ? query : (dropoff?.label ?? '')}
              placeholder="Où va le client ?"
              onFocus={() => { setEditing('dropoff'); setQuery(dropoff?.label ?? ''); }}
              onChange={setQuery}
              onClear={() => {
                dropoffMarkerRef.current?.remove();
                dropoffMarkerRef.current = null;
                setDropoff(null);
              }}
            />

            {editing && (
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                {searching && <div className="px-3 py-2 text-sm text-slate-500">Recherche…</div>}
                {!searching && query.length < 2 && (
                  <div className="px-3 py-2 text-xs text-slate-500">
                    Tapez au moins 2 lettres, ou cliquez sur la carte.
                  </div>
                )}
                {!searching && results.length === 0 && query.length >= 2 && (
                  <div className="px-3 py-2 text-xs text-slate-500">Aucun résultat.</div>
                )}
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => pickResult(r)}
                    className="block w-full text-left px-3 py-2 hover:bg-white border-b border-slate-200 last:border-b-0"
                  >
                    <div className="text-sm font-medium text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500 truncate">{r.label}</div>
                  </button>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-slate-200" />

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Nom du passager
              </label>
              <input
                className="input"
                value={passengerName}
                onChange={(e) => setPassengerName(e.target.value)}
                placeholder="Ex: Aminetou Mint M."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Téléphone du passager
              </label>
              <input
                className="input"
                value={passengerPhone}
                onChange={(e) => setPassengerPhone(e.target.value)}
                placeholder="+222 4X XX XX XX"
              />
              <p className="text-xs text-slate-500 mt-1">
                Servira au chauffeur s'il a besoin d'appeler le passager.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <div className="flex gap-2">
                {(['passenger', 'colis'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setRideType(t)}
                    className={clsx(
                      'flex-1 px-3 py-2 rounded-lg text-sm border',
                      rideType === t
                        ? 'border-brand-600 bg-brand-50 text-brand-700 font-medium'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {t === 'passenger' ? 'Passager' : 'Colis'}
                  </button>
                ))}
              </div>
            </div>

            {pickup && dropoff && (
              <div className="bg-slate-100 rounded-lg p-3">
                <div className="text-xs text-slate-500">
                  Tarif estimé · {estimateKm?.toFixed(1)} km
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {estimateMru} MRU
                </div>
              </div>
            )}

            {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}

            <button
              onClick={submit}
              disabled={submitting || !pickup || !dropoff || !passengerName || !passengerPhone}
              className="btn-primary w-full"
            >
              {submitting ? 'Création…' : 'Créer la course'}
            </button>
          </div>

          {/* Right column: map */}
          <div className="card overflow-hidden h-[600px] relative">
            <div ref={mapContainer} className="w-full h-full" />
            {!mapReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 text-slate-500">
                Chargement de la carte…
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function AddressField(props: {
  color: string;
  label: string;
  placeholder: string;
  place: Place | null;
  active: boolean;
  value: string;
  onFocus: () => void;
  onChange: (s: string) => void;
  onClear: () => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{props.label}</label>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-lg border px-3 py-2 transition',
          props.active
            ? 'border-brand-500 bg-brand-50'
            : 'border-slate-300 bg-white',
        )}
      >
        <span
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: props.color }}
        />
        <input
          value={props.value}
          onFocus={props.onFocus}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          className="flex-1 bg-transparent outline-none text-sm text-slate-900"
        />
        {props.place && (
          <button
            onClick={props.onClear}
            className="text-xs text-slate-400 hover:text-red-600"
            title="Effacer"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function haversineMeters(a: Place, b: Place): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const A = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(A));
}
