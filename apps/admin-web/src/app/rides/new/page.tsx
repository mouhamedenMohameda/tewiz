'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MapShell } from '@/components/Map';
import type { MapRef, MarkerDragEvent, MapMouseEvent } from 'react-map-gl/mapbox';
import { Marker } from 'react-map-gl/mapbox';
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

type Field = 'pickup' | 'dropoff';

export default function NewRidePage() {
  const router = useRouter();
  const mapRef = useRef<MapRef | null>(null);

  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);

  const [editing, setEditing] = useState<Field | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [rideType, setRideType] = useState<'passenger' | 'colis'>('passenger');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [packageDescription, setPackageDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Course ouverte ("taxi à la course"): no upfront destination, the meter
  // runs server-side from the captain's GPS. Only meaningful for passenger
  // rides. We fetch the tariff once so the form shows the rate before the
  // operator commits.
  const [isOpen, setIsOpen] = useState(false);
  // The map click handler is bound once at mount, so it captures `isOpen=false`
  // from the first render. We mirror the state into a ref so the closure can
  // read the current value without re-binding.
  const isOpenRef = useRef(false);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  const [openQuote, setOpenQuote] = useState<{
    enabled: boolean;
    baseFareMru: number;
    perKmMru: number;
    perMinuteMru: number;
    minFareMru: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    // /admin/rides/open-quote mirrors the rider endpoint but is gated to the
    // admin role (the rider one would 403 against an admin token).
    api.get('/admin/rides/open-quote')
      .then((r) => { if (!cancelled) setOpenQuote(r.data); })
      .catch(() => { /* feature stays hidden */ });
    return () => { cancelled = true; };
  }, []);
  // Auto-disable when the operator picks colis — open metered rides are
  // passenger-only.
  useEffect(() => { if (rideType === 'colis' && isOpen) setIsOpen(false); }, [rideType, isOpen]);
  // Clear the dropoff marker when switching ON so the map doesn't lie.
  useEffect(() => {
    if (!isOpen) return;
    setDropoff(null);
  }, [isOpen]);

  // Map click — Open ride mode places/moves the pickup only.
  const handleMapClick = useCallback((e: MapMouseEvent) => {
    const p: Place = { lat: e.lngLat.lat, lng: e.lngLat.lng };
    if (isOpenRef.current) {
      setPickup(p);
      return;
    }
    if (!pickupRef.current) {
      setPickup(p);
    } else {
      setDropoff(p);
    }
  }, []);

  // Mirror pickup/dropoff into refs so the (stable) click handler reads the
  // current values without re-binding on every render.
  const pickupRef = useRef<Place | null>(null);
  const dropoffRef = useRef<Place | null>(null);
  useEffect(() => { pickupRef.current = pickup; }, [pickup]);
  useEffect(() => { dropoffRef.current = dropoff; }, [dropoff]);

  function applyPlace(field: Field, p: Place) {
    if (field === 'pickup') setPickup(p);
    else setDropoff(p);
    mapRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 14 });
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

  // 3. Fare estimate — fetched from the backend so the colis tariff is honored.
  const [estimateMru, setEstimateMru] = useState<number | null>(null);
  const [estimateKm, setEstimateKm] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  useEffect(() => {
    if (isOpen || !pickup || !dropoff) {
      setEstimateMru(null);
      setEstimateKm(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setEstimating(true);
      try {
        const r = await api.post('/admin/rides/estimate', {
          pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng, label: dropoff.label },
          rideType,
        });
        if (cancelled) return;
        setEstimateMru(r.data?.fareMru ?? null);
        setEstimateKm(
          typeof r.data?.distanceM === 'number' ? r.data.distanceM / 1000 : null,
        );
      } catch {
        if (cancelled) return;
        setEstimateMru(null);
        setEstimateKm(null);
      } finally {
        if (!cancelled) setEstimating(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, rideType, isOpen]);

  async function submit() {
    if (!pickup) {
      setErrorMsg('Sélectionnez le point de départ.');
      return;
    }
    if (!isOpen && !dropoff) {
      setErrorMsg('Sélectionnez la destination, ou activez « Course ouverte ».');
      return;
    }
    if (!passengerName.trim() || !passengerPhone.trim()) {
      setErrorMsg('Nom et téléphone du passager requis.');
      return;
    }
    if (rideType === 'colis') {
      if (!recipientName.trim() || !recipientPhone.trim()) {
        setErrorMsg('Nom et téléphone du destinataire requis pour un colis.');
        return;
      }
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const r = await api.post('/admin/rides', {
        pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
        ...(isOpen
          ? { isOpen: true }
          : { dropoff: { lat: dropoff!.lat, lng: dropoff!.lng, label: dropoff!.label } }),
        rideType,
        passengerName: passengerName.trim(),
        passengerPhone: passengerPhone.trim(),
        ...(rideType === 'colis' && {
          recipientName: recipientName.trim(),
          recipientPhone: recipientPhone.trim(),
          packageDescription: packageDescription.trim() || undefined,
        }),
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
                setPickup(null);
              }}
            />
            {isOpen ? (
              <OpenTariffCard quote={openQuote} />
            ) : (
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
                  setDropoff(null);
                }}
              />
            )}

            {/* Course ouverte toggle: shown only when the feature is enabled
                in app_settings AND the operator is on a passenger ride. */}
            {rideType === 'passenger' && openQuote?.enabled ? (
              <OpenRideToggle value={isOpen} onChange={setIsOpen} />
            ) : null}

            {!isOpen && editing && (
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
                {rideType === 'colis' ? "Nom de l'expéditeur" : 'Nom du passager'}
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
                {rideType === 'colis' ? "Téléphone de l'expéditeur" : 'Téléphone du passager'}
              </label>
              <input
                className="input"
                value={passengerPhone}
                onChange={(e) => setPassengerPhone(e.target.value)}
                placeholder="+222 4X XX XX XX"
              />
              <p className="text-xs text-slate-500 mt-1">
                {rideType === 'colis'
                  ? "Personne qui remet le colis au chauffeur au point de départ."
                  : "Servira au chauffeur s'il a besoin d'appeler le passager."}
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

            {rideType === 'colis' && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-medium text-slate-600">
                  Destinataire du colis
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Nom du destinataire
                  </label>
                  <input
                    className="input"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="Ex: Mohamed Ould A."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Téléphone du destinataire
                  </label>
                  <input
                    className="input"
                    value={recipientPhone}
                    onChange={(e) => setRecipientPhone(e.target.value)}
                    placeholder="+222 4X XX XX XX"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Description du colis (optionnel)
                  </label>
                  <input
                    className="input"
                    value={packageDescription}
                    onChange={(e) => setPackageDescription(e.target.value)}
                    placeholder="Ex: sachet de documents"
                  />
                </div>
              </div>
            )}

            {isOpen && pickup && openQuote ? (
              <div className="bg-slate-900 text-white rounded-lg p-3">
                <div className="text-xs text-slate-400">Tarif au compteur</div>
                <div className="text-lg font-bold mt-1">
                  {openQuote.baseFareMru} MRU départ
                  {' + '}{openQuote.perKmMru}/km
                  {' + '}{openQuote.perMinuteMru}/min
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Course minimum {openQuote.minFareMru} MRU. Le chauffeur termine la course.
                </div>
              </div>
            ) : null}
            {!isOpen && pickup && dropoff && (
              <div className="bg-slate-100 rounded-lg p-3">
                <div className="text-xs text-slate-500">
                  Tarif estimé{estimateKm != null ? ` · ${estimateKm.toFixed(1)} km` : ''}
                  {' '}({rideType === 'colis' ? 'colis' : 'passager'})
                </div>
                <div className="text-2xl font-bold text-slate-900">
                  {estimating || estimateMru == null ? '…' : `${estimateMru} MRU`}
                </div>
              </div>
            )}

            {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}

            <button
              onClick={submit}
              disabled={
                submitting ||
                !pickup ||
                (!isOpen && !dropoff) ||
                !passengerName ||
                !passengerPhone ||
                (rideType === 'colis' && (!recipientName || !recipientPhone))
              }
              className="btn-primary w-full"
            >
              {submitting
                ? 'Création…'
                : (isOpen ? 'Créer la course (compteur)' : 'Créer la course')}
            </button>
          </div>

          {/* Right column: map */}
          <div className="card overflow-hidden h-[600px] relative">
            <MapShell
              ref={mapRef}
              onClick={handleMapClick}
              initialViewState={{
                longitude: DEFAULT_CENTER.lng,
                latitude: DEFAULT_CENTER.lat,
                zoom: 12,
              }}
            >
              {pickup && (
                <Marker
                  longitude={pickup.lng}
                  latitude={pickup.lat}
                  anchor="bottom"
                  draggable
                  onDragEnd={(e: MarkerDragEvent) =>
                    setPickup({ lat: e.lngLat.lat, lng: e.lngLat.lng })
                  }
                >
                  <ColoredPin color={PICKUP_COLOR} />
                </Marker>
              )}
              {!isOpen && dropoff && (
                <Marker
                  longitude={dropoff.lng}
                  latitude={dropoff.lat}
                  anchor="bottom"
                  draggable
                  onDragEnd={(e: MarkerDragEvent) =>
                    setDropoff({ lat: e.lngLat.lat, lng: e.lngLat.lng })
                  }
                >
                  <ColoredPin color={DROPOFF_COLOR} />
                </Marker>
              )}
            </MapShell>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ColoredPin({ color }: { color: string }) {
  return (
    <svg
      width="26"
      height="36"
      viewBox="0 0 26 36"
      fill={color}
      stroke="#fff"
      strokeWidth="2"
      style={{ cursor: 'grab', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))' }}
    >
      <path d="M13 0C6.4 0 1 5.4 1 12c0 9 12 24 12 24s12-15 12-24c0-6.6-5.4-12-12-12z" />
    </svg>
  );
}

function OpenRideToggle({
  value, onChange,
}: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={clsx(
        'w-full flex items-center gap-3 rounded-lg px-3 py-3 transition border text-left',
        value
          ? 'bg-slate-900 border-slate-900 text-white'
          : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300',
      )}
    >
      <span
        className={clsx(
          'inline-flex w-11 h-6 rounded-full p-0.5 transition shrink-0',
          value ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span
          className={clsx(
            'block w-5 h-5 rounded-full bg-white shadow transition-transform',
            value ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
      <span className="flex-1">
        <span className="block text-sm font-semibold">Course ouverte</span>
        <span className={clsx('block text-xs', value ? 'text-slate-300' : 'text-slate-500')}>
          Pas de destination — le compteur démarre à bord
        </span>
      </span>
    </button>
  );
}

function OpenTariffCard({
  quote,
}: { quote: { baseFareMru: number; perKmMru: number; perMinuteMru: number; minFareMru: number } | null }) {
  if (!quote) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
        Chargement du tarif au compteur…
      </div>
    );
  }
  return (
    <div className="rounded-lg bg-slate-900 text-white px-3 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-emerald-400 uppercase">
        Tarif au compteur
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Cell value={`${quote.baseFareMru}`} unit="MRU" label="Départ" />
        <Cell value={`${quote.perKmMru}`} unit="MRU/km" label="Distance" />
        <Cell value={`${quote.perMinuteMru}`} unit="MRU/min" label="Temps" />
      </div>
      <div className="mt-2 text-[11px] text-slate-400">
        Course minimum {quote.minFareMru} MRU. Seul le chauffeur peut terminer la course.
      </div>
    </div>
  );
}

function Cell({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="bg-slate-800 rounded p-2 text-center">
      <div className="text-base font-bold text-amber-300">{value}</div>
      <div className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">{unit}</div>
      <div className="text-[9px] text-slate-500 mt-0.5">{label}</div>
    </div>
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

