'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { CaptainsMap, type CaptainMarker } from './CaptainsMap';

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
};

type Filter = 'all' | 'connected' | 'offline';

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

  const counts = useMemo(() => {
    const c = { total: 0, online: 0, on_ride: 0, paused: 0, offline: 0 };
    for (const x of data ?? []) {
      c.total++;
      if (x.presence === 'online') c.online++;
      else if (x.presence === 'on_ride') c.on_ride++;
      else if (x.presence === 'paused') c.paused++;
      else c.offline++;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (filter === 'connected' && c.presence === 'offline') return false;
      if (filter === 'offline' && c.presence !== 'offline') return false;
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

  return (
    <AppShell>
      <div className="h-screen flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Chauffeurs</h1>
              <p className="text-sm text-slate-500">
                Vue temps réel · rafraîchi toutes les 10 s
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatChip label="Total" value={counts.total} dot="bg-slate-400" />
              <StatChip label="En ligne" value={counts.online} dot="bg-emerald-500" />
              <StatChip label="En course" value={counts.on_ride} dot="bg-orange-500" />
              <StatChip label="Hors ligne" value={counts.offline} dot="bg-slate-300" />
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar list */}
          <aside className="w-[420px] border-r border-slate-200 bg-white flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-200 space-y-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher nom, téléphone, plaque, véhicule…"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              <div className="flex gap-1">
                {(['all', 'connected', 'offline'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={clsx(
                      'flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition',
                      filter === f
                        ? 'bg-brand-100 text-brand-800'
                        : 'text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {f === 'all' ? 'Tous' : f === 'connected' ? 'Connectés' : 'Hors ligne'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {isLoading && (
                <div className="p-6 text-sm text-slate-500">Chargement…</div>
              )}
              {!isLoading && visible.length === 0 && (
                <div className="p-6 text-sm text-slate-500">Aucun chauffeur.</div>
              )}
              <ul className="divide-y divide-slate-100">
                {visible.map((c) => (
                  <li key={c.id}>
                    <CaptainRow
                      captain={c}
                      selected={selectedId === c.id}
                      onClick={() => setSelectedId(c.id)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Map + detail overlay */}
          <div className="flex-1 min-h-0 relative">
            <CaptainsMap
              captains={data ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            {selected && (
              <CaptainDetailCard
                captain={selected}
                onClose={() => setSelectedId(null)}
              />
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
  onClose,
}: {
  captain: Captain;
  onClose: () => void;
}) {
  const rating = formatRating(c.rating_avg);
  return (
    <div className="absolute top-4 right-4 w-[340px] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden z-10">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">
            {c.fullName?.trim() || 'Sans nom'}
          </div>
          <div className="text-xs text-slate-500 font-mono">{c.phone}</div>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          aria-label="Fermer"
        >
          ×
        </button>
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
    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
      <span className={clsx('w-2 h-2 rounded-full', dot)} />
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
