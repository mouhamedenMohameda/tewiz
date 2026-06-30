'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AppShell } from '@/components/AppShell';
import { api, fetchBlobUrl } from '@/lib/api';
import { VoiceRequestMap } from './VoiceRequestMap';
import type {
  VoiceRideRequest,
  VoiceRideStatus,
  PoiCandidate,
  PoiSearchResponse,
  Pin,
  PinSide,
} from './types';

const NKT_CENTER = { lat: 18.0858, lng: -15.9785 };

const STATUS_TABS: { value: VoiceRideStatus | 'all'; label: string }[] = [
  { value: 'pending', label: 'En attente' },
  { value: 'confirmed', label: 'Confirmées' },
  { value: 'rejected', label: 'Rejetées' },
  { value: 'cancelled', label: 'Annulées' },
  { value: 'all', label: 'Toutes' },
];

const STATUS_BADGE: Record<VoiceRideStatus, string> = {
  pending: 'badge-pending',
  confirmed: 'badge-approved',
  rejected: 'badge-rejected',
  cancelled: 'badge-neutral',
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
function fmtAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `il y a ${Math.floor(s)}s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)}min`;
  return `il y a ${Math.floor(s / 3600)}h`;
}
function fmtDur(sec: number | null) {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m ? `${m}m${String(s).padStart(2, '0')}` : `${s}s`;
}

export default function VoiceRequestsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<VoiceRideStatus | 'all'>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Queue (5 s polling while showing the pending queue) ────────────────────
  const queue = useQuery({
    queryKey: ['voice-rides', filter],
    queryFn: async () => {
      const r = await api.get<VoiceRideRequest[]>(`/admin/voice-rides?status=${filter}`);
      return r.data;
    },
    refetchInterval: filter === 'pending' ? 5_000 : false,
  });

  // ── Selected request detail ────────────────────────────────────────────────
  const detail = useQuery({
    queryKey: ['voice-ride', selectedId],
    queryFn: async () => {
      const r = await api.get<VoiceRideRequest>(`/admin/voice-rides/${selectedId}`);
      return r.data;
    },
    enabled: !!selectedId,
  });

  const selected = detail.data ?? null;
  const isPending = selected?.status === 'pending';

  // ── Pins (dispatcher's pickup/dropoff) ─────────────────────────────────────
  const [pickup, setPickup] = useState<Pin | null>(null);
  const [dropoff, setDropoff] = useState<Pin | null>(null);
  const [activeSide, setActiveSide] = useState<PinSide>('pickup');
  const [payment, setPayment] = useState<'cash' | 'wallet'>('cash');

  // Reset/prefill pins whenever the selected request changes.
  useEffect(() => {
    if (!selected) { setPickup(null); setDropoff(null); return; }
    setPickup(selected.pickup ? { ...selected.pickup, label: selected.pickup.label ?? undefined } : null);
    setDropoff(selected.dropoff ? { ...selected.dropoff, label: selected.dropoff.label ?? undefined } : null);
    setActiveSide('pickup');
    setPayment('cash');
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setSide(side: PinSide, lat: number, lng: number) {
    const pin: Pin = { lat, lng };
    if (side === 'pickup') setPickup(pin); else setDropoff(pin);
  }
  function pickCandidate(c: PoiCandidate) {
    const pin: Pin = {
      lat: c.lat, lng: c.lng, label: c.label || c.name,
      placeId: c.placeId, name: c.name, source: c.source, types: c.types,
    };
    if (activeSide === 'pickup') setPickup(pin); else setDropoff(pin);
  }

  // ── Mutations ──────────────────────────────────────────────────────────────
  const confirm = useMutation({
    mutationFn: async () => {
      const r = await api.post(`/admin/voice-rides/${selectedId}/confirm`, {
        pickup, dropoff, paymentMethod: payment,
      });
      return r.data as VoiceRideRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice-rides'] });
      qc.invalidateQueries({ queryKey: ['voice-ride', selectedId] });
    },
  });

  const reject = useMutation({
    mutationFn: async (reason: string) => {
      const r = await api.post(`/admin/voice-rides/${selectedId}/reject`, { reason });
      return r.data as VoiceRideRequest;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['voice-rides'] });
      qc.invalidateQueries({ queryKey: ['voice-ride', selectedId] });
    },
  });

  const proximity = useMemo(() => {
    const c = pickup ?? dropoff ?? NKT_CENTER;
    return `${c.lng},${c.lat}`;
  }, [pickup, dropoff]);

  const canConfirm = isPending && !!pickup && !!dropoff && !confirm.isPending;

  // Mobile navigation: when a request is selected, the queue is hidden and
  // the detail + map appear. A back button returns to the queue.
  const showDetailOnMobile = !!selectedId;

  return (
    <AppShell>
      <div className="flex flex-col lg:flex-row h-[calc(100dvh-3.5rem)] lg:h-screen">
        {/* ── Column 1: queue ──────────────────────────────────────────────── */}
        <div
          className={clsx(
            'lg:w-80 lg:shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0',
            'flex-1 lg:flex-initial',
            showDetailOnMobile && 'hidden lg:flex',
          )}
        >
          <div className="px-4 py-4 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-slate-900">🎙️ Demandes vocales</h1>
              {queue.isFetching && <span className="text-xs text-slate-400">↻</span>}
            </div>
            <div className="flex flex-wrap gap-1 mt-3">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setFilter(t.value)}
                  className={clsx(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition',
                    filter === t.value
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            {queue.isLoading ? (
              <div className="p-4 text-sm text-slate-500">Chargement…</div>
            ) : (queue.data?.length ?? 0) === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">
                Aucune demande {filter === 'pending' ? 'en attente' : ''}.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {queue.data!.map((v) => (
                  <li key={v.id}>
                    <button
                      onClick={() => setSelectedId(v.id)}
                      className={clsx(
                        'w-full text-left px-4 py-3 hover:bg-slate-50 transition',
                        selectedId === v.id && 'bg-brand-50',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-slate-800 text-sm truncate">
                          {v.user.fullName ?? v.user.phone}
                        </span>
                        <span className={STATUS_BADGE[v.status]}>{v.status}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-xs text-slate-500">
                        <span>🎧 {fmtDur(v.audioDurationS) || '—'}</span>
                        <span>{fmtAgo(v.createdAt)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Column 2: detail + audio + actions ───────────────────────────── */}
        <div
          className={clsx(
            'lg:w-96 lg:shrink-0 border-r border-slate-200 bg-white flex flex-col overflow-auto min-h-0',
            showDetailOnMobile ? 'flex max-h-[55vh] lg:max-h-none' : 'hidden lg:flex',
          )}
        >
          {/* Mobile-only back button */}
          {showDetailOnMobile && (
            <div className="lg:hidden sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-2">
              <button
                onClick={() => setSelectedId(null)}
                className="p-1.5 -ml-1.5 rounded-md text-slate-600 hover:bg-slate-100"
                aria-label="Retour à la file"
              >
                ←
              </button>
              <span className="text-sm font-medium text-slate-700 truncate">
                {selected?.user.fullName ?? selected?.user.phone ?? 'Demande'}
              </span>
            </div>
          )}
          {!selected ? (
            <div className="flex-1 grid place-items-center text-sm text-slate-400 p-6 text-center">
              Sélectionne une demande pour l’écouter et la traiter.
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">
                    {selected.user.fullName ?? 'Client'}
                  </h2>
                  <span className={STATUS_BADGE[selected.status]}>{selected.status}</span>
                </div>
                <a href={`tel:${selected.user.phone}`} className="text-sm text-brand-700">
                  {selected.user.phone}
                </a>
                <div className="text-xs text-slate-400 mt-0.5">
                  Reçue {fmtTime(selected.createdAt)}
                </div>
              </div>

              <AudioPlayer requestId={selected.id} />

              {selected.transcript && (
                <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                    Transcription
                  </div>
                  {selected.transcript}
                </div>
              )}

              {/* Pins summary + active-side toggle */}
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 mb-2">
                  Itinéraire
                </div>
                <div className="space-y-2">
                  <PinRow
                    side="pickup" label="Départ" badge="A" color="text-green-700"
                    pin={pickup} active={activeSide === 'pickup'}
                    onActivate={() => setActiveSide('pickup')}
                    onClear={isPending ? () => setPickup(null) : undefined}
                  />
                  <PinRow
                    side="dropoff" label="Destination" badge="B" color="text-red-700"
                    pin={dropoff} active={activeSide === 'dropoff'}
                    onActivate={() => setActiveSide('dropoff')}
                    onClear={isPending ? () => setDropoff(null) : undefined}
                  />
                </div>
              </div>

              {isPending && (
                <>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                      Paiement
                    </div>
                    <div className="flex gap-2">
                      {(['cash', 'wallet'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setPayment(p)}
                          className={clsx(
                            'px-3 py-1.5 rounded-lg text-sm border',
                            payment === p
                              ? 'border-brand-500 bg-brand-50 text-brand-700'
                              : 'border-slate-300 text-slate-600',
                          )}
                        >
                          {p === 'cash' ? 'Espèces' : 'Wallet'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {confirm.isError && (
                    <div className="text-sm text-red-600">
                      {extractError(confirm.error)}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <button
                      className="btn-primary flex-1"
                      disabled={!canConfirm}
                      onClick={() => confirm.mutate()}
                    >
                      {confirm.isPending ? 'Création…' : 'Confirmer la course'}
                    </button>
                    <button
                      className="btn-danger"
                      disabled={reject.isPending}
                      onClick={() => {
                        const reason = window.prompt('Raison du rejet ?');
                        if (reason && reason.trim().length >= 2) reject.mutate(reason.trim());
                      }}
                    >
                      Rejeter
                    </button>
                  </div>
                  {!pickup || !dropoff ? (
                    <p className="text-xs text-slate-400">
                      Place le départ et la destination (clic sur la carte ou recherche) pour confirmer.
                    </p>
                  ) : null}
                </>
              )}

              {selected.status === 'confirmed' && selected.rideId && (
                <a href={`/rides/${selected.rideId}`} className="btn-secondary w-full">
                  Voir la course →
                </a>
              )}
              {selected.status === 'rejected' && selected.rejectReason && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3">
                  Rejetée : {selected.rejectReason}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Column 3: map + POI search ───────────────────────────────────── */}
        <div
          className={clsx(
            'flex-1 flex flex-col bg-slate-50 min-w-0 min-h-0',
            showDetailOnMobile ? 'flex' : 'hidden lg:flex',
          )}
        >
          {selected && isPending && (
            <PoiSearch
              proximity={proximity}
              activeSide={activeSide}
              onPick={pickCandidate}
            />
          )}
          <div className="flex-1 min-h-[40vh] lg:min-h-0">
            <VoiceRequestMap
              pickup={pickup}
              dropoff={dropoff}
              activeSide={activeSide}
              onSet={setSide}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ── Authenticated audio player ───────────────────────────────────────────────
function AudioPlayer({ requestId }: { requestId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let obj: string | null = null;
    setUrl(null); setErr(false);
    fetchBlobUrl(`/admin/voice-rides/${requestId}/audio`)
      .then((u) => { if (cancelled) { URL.revokeObjectURL(u); return; } obj = u; setUrl(u); })
      .catch(() => setErr(true));
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [requestId]);

  if (err) return <div className="text-sm text-red-600">⚠ Audio indisponible</div>;
  if (!url) return <div className="h-12 bg-slate-100 rounded-lg animate-pulse" />;
  // eslint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls src={url} className="w-full" />;
}

// ── Pin summary row ──────────────────────────────────────────────────────────
function PinRow({
  label, badge, color, pin, active, onActivate, onClear,
}: {
  side: PinSide; label: string; badge: string; color: string;
  pin: Pin | null; active: boolean;
  onActivate: () => void; onClear?: () => void;
}) {
  return (
    <button
      onClick={onActivate}
      className={clsx(
        'w-full flex items-center gap-2 text-left rounded-lg border px-2.5 py-2 transition',
        active ? 'border-brand-500 ring-1 ring-brand-200' : 'border-slate-200 hover:border-slate-300',
      )}
    >
      <span className={clsx('font-bold', color)}>{badge}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-slate-400">{label}</span>
        <span className="block text-sm text-slate-700 truncate">
          {pin ? (pin.label ?? `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`) : '— à placer'}
        </span>
      </span>
      {pin && onClear && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="text-slate-400 hover:text-red-600 text-sm px-1"
        >
          ✕
        </span>
      )}
    </button>
  );
}

// ── POI search panel ─────────────────────────────────────────────────────────
function PoiSearch({
  proximity, activeSide, onPick,
}: {
  proximity: string; activeSide: PinSide; onPick: (c: PoiCandidate) => void;
}) {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');

  const search = useQuery({
    queryKey: ['poi', submitted, proximity],
    queryFn: async () => {
      const r = await api.get<PoiSearchResponse>(
        `/admin/voice-rides/poi-search?q=${encodeURIComponent(submitted)}&proximity=${proximity}`,
      );
      return r.data;
    },
    enabled: submitted.trim().length >= 2,
  });

  return (
    <div className="border-b border-slate-200 bg-white">
      <form
        onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }}
        className="flex gap-2 p-3"
      >
        <input
          className="input"
          placeholder={`Rechercher un lieu pour ${activeSide === 'pickup' ? 'le départ (A)' : 'la destination (B)'}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn-secondary shrink-0">Chercher</button>
      </form>

      {search.isFetching && (
        <div className="px-3 pb-3 text-xs text-slate-400">Recherche…</div>
      )}
      {search.data && (
        <div className="max-h-56 overflow-auto px-3 pb-3 space-y-1">
          {search.data.candidates.length === 0 ? (
            <div className="text-xs text-slate-400">Aucun résultat.</div>
          ) : (
            search.data.candidates.map((c) => (
              <button
                key={`${c.source}:${c.placeId}`}
                onClick={() => onPick(c)}
                className="w-full text-left rounded-lg border border-slate-200 hover:border-brand-400 hover:bg-brand-50 px-3 py-2 transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{c.name}</span>
                  <SourceBadge source={c.source} />
                </div>
                <div className="text-xs text-slate-500 truncate">{c.label}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: PoiCandidate['source'] }) {
  const map = {
    local: { t: 'Corpus', c: 'badge-approved' },
    google: { t: 'Google', c: 'badge-info' },
    nominatim: { t: 'OSM', c: 'badge-neutral' },
  } as const;
  const s = map[source];
  return <span className={clsx(s.c, 'shrink-0')}>{s.t}</span>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractError(err: any): string {
  const raw =
    err?.response?.data?.message ??
    err?.response?.data?.error ??
    err?.message;
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (raw && typeof raw === 'object') {
    if (typeof raw.message === 'string') return raw.message;
    try { return JSON.stringify(raw); } catch { /* fallthrough */ }
  }
  return 'Erreur lors de la confirmation';
}
