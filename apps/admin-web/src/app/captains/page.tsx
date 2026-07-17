'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import type { CaptainMarker, TrackPoint } from './CaptainsMap';

// Mapbox (mapbox-gl + react-map-gl, ~230 KB gzip) is the heaviest thing on this
// page. Load it lazily and client-only so the captain list/table paints and
// becomes interactive immediately, with the map streaming in right after.
const CaptainsMap = dynamic(
  () => import('./CaptainsMap').then((m) => m.CaptainsMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full grid place-items-center bg-slate-100 text-sm text-slate-400">
        Chargement de la carte…
      </div>
    ),
  },
);

type CaptainStatus = 'active' | 'suspended' | 'banned' | 'pending';

type Captain = CaptainMarker & {
  // 'pending' = user with role='captain' but no captains row (never approved)
  status: CaptainStatus;
  rating_avg: number | string | null;
  total_rides: number | null;
  last_seen: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  // Off-ride breadcrumb availability (last 24 h), from /admin/captains.
  track_points: number;
  track_last: string | null;
  // Captain-reported background-location permission (migration 0068).
  track_perm: 'granted' | 'denied' | null;
};

type Filter = 'all' | 'connected' | 'offline' | 'tracked';

export default function CaptainsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-captains'],
    queryFn: async () => {
      const r = await api.get('/admin/captains');
      return r.data as Captain[];
    },
    refetchInterval: 10_000,
  });

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Off-ride breadcrumb trail of the selected captain (last 24 h), drawn as a
  // polyline on the map. Only fetched when a captain is selected.
  const { data: track } = useQuery({
    queryKey: ['admin-captain-track', selectedId],
    enabled: !!selectedId,
    refetchInterval: 15_000,
    queryFn: async () => {
      const r = await api.get(`/admin/captains/${selectedId}/track`);
      return (r.data.points ?? []) as TrackPoint[];
    },
  });

  const trail = selectedId ? track : undefined;
  const hasTrail = !!trail && trail.length >= 2;

  // Replay cursor: index into the trail up to which the path is "traveled".
  // null = not replaying (whole path shown). Reset whenever the selection or
  // the trail length changes so we never point past the end of a shorter trail.
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setReplayIndex(null);
    setPlaying(false);
  }, [selectedId, trail?.length]);

  // Drive the replay: advance one point every 350 ms while playing.
  useEffect(() => {
    if (!playing || !hasTrail) return;
    const n = trail!.length;
    const id = setInterval(() => {
      setReplayIndex((i) => {
        const next = (i == null ? 0 : i) + 1;
        if (next >= n - 1) {
          setPlaying(false);
          return n - 1;
        }
        return next;
      });
    }, 350);
    return () => clearInterval(id);
  }, [playing, hasTrail, trail]);

  const togglePlay = () => {
    if (!hasTrail) return;
    // Restart from the beginning when replaying after reaching the end.
    if (!playing && (replayIndex == null || replayIndex >= trail!.length - 1)) {
      setReplayIndex(0);
    }
    setPlaying((p) => !p);
  };

  const counts = useMemo(() => {
    const c = { total: 0, online: 0, on_ride: 0, paused: 0, offline: 0, tracked: 0, denied: 0 };
    for (const x of data ?? []) {
      c.total++;
      if (x.presence === 'online') c.online++;
      else if (x.presence === 'on_ride') c.on_ride++;
      else if (x.presence === 'paused') c.paused++;
      else c.offline++;
      // Emitting a trail (24 h) vs. connected but declined background location.
      if (x.track_points > 0) c.tracked++;
      if (x.track_perm === 'denied' && x.presence !== 'offline') c.denied++;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (filter === 'connected' && c.presence === 'offline') return false;
      if (filter === 'offline' && c.presence !== 'offline') return false;
      if (filter === 'tracked' && !(c.track_points > 0)) return false;
      if (s) {
        const hay = `${c.fullName ?? ''} ${c.phone} ${c.plate ?? ''} ${c.brand ?? ''} ${c.model ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, filter, search]);

  const selected = useMemo(
    () => (data ?? []).find((c) => c.id === selectedId) ?? null,
    [data, selectedId],
  );

  // Whether the floating detail card is collapsed. Collapsing hides the card
  // WITHOUT clearing the selection, so the trail stays drawn on the map.
  // Reset every time a different captain is picked so the card reappears.
  const [detailHidden, setDetailHidden] = useState(false);
  useEffect(() => {
    setDetailHidden(false);
  }, [selectedId]);

  // Mobile-only view toggle: list ↔ map (detail card still floats over map)
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  return (
    <AppShell>
      <div className="h-[calc(100dvh-3.5rem)] lg:h-screen flex flex-col">
        {/* Header */}
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-slate-200 bg-white">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-slate-900">Captains</h1>
              <p className="text-xs md:text-sm text-slate-500">
                Vue temps réel · rafraîchi toutes les 10 s
              </p>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
              <StatChip label="Total" value={counts.total} dot="bg-slate-400" />
              <StatChip label="En ligne" value={counts.online} dot="bg-emerald-500" />
              <StatChip label="En course" value={counts.on_ride} dot="bg-orange-500" />
              <StatChip label="Hors ligne" value={counts.offline} dot="bg-slate-300" />
              <StatChip label="🛰️ Suivis" value={counts.tracked} dot="bg-orange-500" />
              {counts.denied > 0 && (
                <StatChip label="⚠️ Loc. refusée" value={counts.denied} dot="bg-red-500" />
              )}
            </div>
          </div>
        </div>

        {/* Mobile-only list ↔ map toggle */}
        <div className="lg:hidden flex border-b border-slate-200 bg-white">
          {(['list', 'map'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setMobileView(v)}
              className={clsx(
                'flex-1 py-2.5 text-sm font-medium transition',
                mobileView === v
                  ? 'text-brand-700 border-b-2 border-brand-600'
                  : 'text-slate-500 border-b-2 border-transparent',
              )}
            >
              {v === 'list' ? '📋 Liste' : '🗺️ Carte'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar list */}
          <aside
            className={clsx(
              'lg:w-[420px] border-r border-slate-200 bg-white flex-col min-h-0',
              'lg:flex',
              mobileView === 'list' ? 'flex w-full' : 'hidden',
            )}
          >
            <div className="p-3 border-b border-slate-200 space-y-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher nom, téléphone, plaque…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              <div className="flex gap-1">
                {(['all', 'connected', 'offline', 'tracked'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={clsx(
                      'flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition whitespace-nowrap',
                      filter === f
                        ? 'bg-brand-100 text-brand-800'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {f === 'all'
                      ? 'Tous'
                      : f === 'connected'
                        ? 'Connectés'
                        : f === 'offline'
                          ? 'Hors ligne'
                          : '🛰️ Trajet'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {isLoading && (
                <div className="p-6 text-sm text-slate-500">Chargement…</div>
              )}
              {!isLoading && visible.length === 0 && (
                <div className="p-6 text-sm text-slate-500">Aucun Captain.</div>
              )}
              <ul className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <li key={c.id}>
                    <CaptainRow
                      captain={c}
                      selected={selectedId === c.id}
                      onClick={() => {
                        setSelectedId(c.id);
                        setMobileView('map');
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Map + detail overlay */}
          <div
            className={clsx(
              'flex-1 min-h-0 relative',
              'lg:block',
              mobileView === 'map' ? 'block' : 'hidden',
            )}
          >
            <CaptainsMap
              captains={data ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
              track={trail}
              replayIndex={replayIndex}
            />
            {selected && !detailHidden && (
              <CaptainDetailCard
                captain={selected}
                onHide={() => setDetailHidden(true)}
                onClose={() => setSelectedId(null)}
              />
            )}
            {selected && detailHidden && (
              <CaptainDetailPill
                captain={selected}
                onOpen={() => setDetailHidden(false)}
                onClose={() => setSelectedId(null)}
              />
            )}
            {selected && hasTrail && (
              <TrackPanel
                points={trail!}
                playing={playing}
                replayIndex={replayIndex}
                onTogglePlay={togglePlay}
                onSeek={(i) => {
                  setPlaying(false);
                  setReplayIndex(i);
                }}
              />
            )}
            {selected && selected.track_points === 0 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-lg bg-white/95 shadow-lg border border-slate-200 text-xs text-slate-500">
                Aucun trajet enregistré pour ce Captain (24 h).
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Sidebar row
// ---------------------------------------------------------------------------

function CaptainRow({
  captain: c,
  selected,
  onClick,
}: {
  captain: Captain;
  selected: boolean;
  onClick: () => void;
}) {
  const vehicle = formatVehicle(c);
  const rating = formatRating(c.rating_avg);
  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left px-4 py-3 hover:bg-slate-50 transition',
        selected && 'bg-brand-50',
      )}
    >
      <div className="flex items-start gap-3">
        <PresenceDot presence={c.presence} className="mt-1.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-slate-900 truncate">
              {c.fullName?.trim() || c.phone}
            </div>
            <StatusBadge status={c.status} />
          </div>
          {c.fullName?.trim() && (
            <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
          )}
          {vehicle && (
            <div className="text-xs text-slate-600 truncate mt-0.5">{vehicle}</div>
          )}
          {(c.track_points > 0 || (c.track_perm === 'denied' && c.presence !== 'offline')) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.track_points > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 border border-orange-200 text-[10px] font-medium">
                  🛰️ Trajet · {c.track_points} pts
                </span>
              )}
              {c.track_perm === 'denied' && c.presence !== 'offline' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 text-[10px] font-medium">
                  ⚠️ Loc. refusée
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
            <span>{presenceLabel(c.presence)}</span>
            <span className="text-slate-300">·</span>
            <span>{formatLastSeen(c.last_seen)}</span>
            {(c.total_rides ?? 0) > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span>{c.total_rides} courses</span>
              </>
            )}
            {rating && (
              <>
                <span className="text-slate-300">·</span>
                <span>{rating}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Floating detail card over the map
// ---------------------------------------------------------------------------

function CaptainDetailCard({
  captain: c,
  onHide,
  onClose,
}: {
  captain: Captain;
  /** Collapse the card but keep the captain selected (trail stays visible). */
  onHide: () => void;
  /** Deselect the captain entirely (removes the trail from the map). */
  onClose: () => void;
}) {
  const rating = formatRating(c.rating_avg);
  return (
    <div className="absolute top-2 right-2 left-2 sm:left-auto sm:top-4 sm:right-4 sm:w-[340px] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-10">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">
            {c.fullName?.trim() || 'Sans nom'}
          </div>
          <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onHide}
            className="w-7 h-7 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg leading-none"
            aria-label="Réduire la fiche (garder le trajet)"
            title="Réduire — le trajet reste affiché"
          >
            –
          </button>
          <button
            onClick={onClose}
            className="w-7 h-7 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-xl leading-none"
            aria-label="Fermer et masquer le trajet"
            title="Fermer — masque aussi le trajet"
          >
            ×
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={c.status} />
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 text-xs text-slate-700">
            <PresenceDot presence={c.presence} />
            {presenceLabel(c.presence)}
          </span>
        </div>

        <DetailRow label="Véhicule" value={formatVehicle(c) ?? 'Non renseigné'} />
        <DetailRow label="Courses" value={`${c.total_rides ?? 0}`} />
        <DetailRow label="Note" value={rating ?? 'Aucune note'} />
        <DetailRow label="Vu" value={formatLastSeen(c.last_seen)} />
        {c.lat != null && c.lng != null && (
          <DetailRow
            label="Position"
            value={`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`}
            mono
          />
        )}
      </div>

      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex gap-2">
        <a
          href={`https://wa.me/${c.phone.replace(/[^\d]/g, '')}`}
          target="_blank"
          rel="noreferrer"
          className="flex-1 px-3 py-1.5 text-xs font-medium text-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-md"
        >
          WhatsApp
        </a>
        <a
          href={`tel:${c.phone}`}
          className="flex-1 px-3 py-1.5 text-xs font-medium text-center bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-md"
        >
          Appeler
        </a>
      </div>
    </div>
  );
}

// Compact pill shown when the detail card is collapsed. Keeps the captain
// selected (trail stays on the map) while getting the big card out of the way.
function CaptainDetailPill({
  captain: c,
  onOpen,
  onClose,
}: {
  captain: Captain;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-10 flex items-center gap-1 bg-white rounded-full shadow-lg border border-slate-200 pl-1 pr-1 py-1">
      <button
        onClick={onOpen}
        className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-full hover:bg-slate-50"
        title="Afficher la fiche du Captain"
      >
        <PresenceDot presence={c.presence} />
        <span className="text-sm font-medium text-slate-800 truncate max-w-[160px]">
          {c.fullName?.trim() || c.phone}
        </span>
        <span className="text-xs text-brand-600 font-medium shrink-0">Détails</span>
      </button>
      <button
        onClick={onClose}
        className="w-7 h-7 grid place-items-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 text-lg leading-none shrink-0"
        aria-label="Désélectionner le Captain"
        title="Désélectionner — masque le trajet"
      >
        ×
      </button>
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={clsx('text-slate-800 text-right truncate', mono && 'font-mono text-xs')}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function StatChip({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap shrink-0">
      <span className={clsx('w-2 h-2 rounded-full shrink-0', dot)} />
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function PresenceDot({ presence, className }: { presence: Captain['presence']; className?: string }) {
  const color =
    presence === 'on_ride' ? 'bg-orange-500'
    : presence === 'online' ? 'bg-emerald-500'
    : presence === 'paused' ? 'bg-slate-400'
    : 'bg-slate-300';
  const ring =
    presence === 'online' || presence === 'on_ride' ? 'ring-2 ring-offset-2 ring-emerald-100' : '';
  return <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', color, ring, className)} />;
}

function StatusBadge({ status }: { status: CaptainStatus }) {
  const cfg = {
    active:    { label: 'Actif',     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    pending:   { label: 'En attente', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    suspended: { label: 'Suspendu',  cls: 'bg-orange-50 text-orange-700 border-orange-200' },
    banned:    { label: 'Banni',     cls: 'bg-red-50 text-red-700 border-red-200' },
  }[status];
  return (
    <span
      className={clsx(
        'shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
        cfg.cls,
      )}
    >
      {cfg.label}
    </span>
  );
}

function presenceLabel(p: Captain['presence']): string {
  if (p === 'on_ride') return 'En course';
  if (p === 'online') return 'En ligne';
  if (p === 'paused') return 'En pause';
  return 'Hors ligne';
}

function formatVehicle(c: Captain): string | null {
  const parts: string[] = [];
  if (c.brand || c.model) parts.push([c.brand, c.model].filter(Boolean).join(' '));
  if (c.color) parts.push(c.color);
  if (c.plate) parts.push(c.plate);
  return parts.length ? parts.join(' · ') : null;
}

function formatRating(r: number | string | null): string | null {
  if (r == null) return null;
  const n = typeof r === 'string' ? parseFloat(r) : r;
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toFixed(1)}★`;
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return d.toLocaleDateString('fr-FR');
}

// ---------------------------------------------------------------------------
// Trail replay panel (floats over the map when a trail is loaded)
// ---------------------------------------------------------------------------

function TrackPanel({
  points,
  playing,
  replayIndex,
  onTogglePlay,
  onSeek,
}: {
  points: TrackPoint[];
  playing: boolean;
  replayIndex: number | null;
  onTogglePlay: () => void;
  onSeek: (i: number) => void;
}) {
  const stats = useMemo(() => trailStats(points), [points]);
  const maxIdx = points.length - 1;
  const cursorIdx = replayIndex ?? maxIdx;
  const cursorTime = points[cursorIdx]?.recordedAt ?? null;

  return (
    <div className="absolute bottom-3 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[520px] z-10 bg-white/95 backdrop-blur rounded-xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="flex items-stretch divide-x divide-slate-100">
        <TrailStat label="Distance" value={`${stats.distKm.toFixed(1)} km`} />
        <TrailStat label="Durée" value={formatDuration(stats.durationMs)} />
        <TrailStat label="Points" value={`${stats.count}`} />
        <TrailStat
          label="Plage"
          value={`${formatClock(points[0]?.recordedAt)}–${formatClock(points[maxIdx]?.recordedAt)}`}
        />
      </div>
      <div className="flex items-center gap-3 px-3 py-2.5 border-t border-slate-100">
        <button
          onClick={onTogglePlay}
          className="shrink-0 w-9 h-9 grid place-items-center rounded-full bg-brand-600 hover:bg-brand-700 text-white text-sm"
          aria-label={playing ? 'Pause' : 'Lire le trajet'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={maxIdx}
          value={cursorIdx}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 accent-brand-600"
          aria-label="Position dans le trajet"
        />
        <span className="shrink-0 text-xs font-mono text-slate-600 tabular-nums w-12 text-right">
          {formatClock(cursorTime)}
        </span>
      </div>
    </div>
  );
}

function TrailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 px-3 py-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trail geometry helpers
// ---------------------------------------------------------------------------

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function trailStats(pts: TrackPoint[]): {
  distKm: number;
  durationMs: number | null;
  count: number;
} {
  let dist = 0;
  for (let i = 1; i < pts.length; i++) {
    dist += haversineKm(pts[i - 1]!.lat, pts[i - 1]!.lng, pts[i]!.lat, pts[i]!.lng);
  }
  const first = pts[0]?.recordedAt ? new Date(pts[0].recordedAt).getTime() : null;
  const last = pts[pts.length - 1]?.recordedAt
    ? new Date(pts[pts.length - 1]!.recordedAt!).getTime()
    : null;
  const durationMs = first != null && last != null ? Math.max(0, last - first) : null;
  return { distKm: dist, durationMs, count: pts.length };
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

function formatClock(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
