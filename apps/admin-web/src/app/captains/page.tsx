'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { CaptainsMap, type CaptainMarker } from './CaptainsMap';

type Captain = CaptainMarker & {
  status: 'active' | 'suspended' | 'banned';
  rating_avg: number;
  total_rides: number;
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
        const hay = `${c.fullName ?? ''} ${c.phone} ${c.plate ?? ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data, filter, search]);

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
          <aside className="w-[380px] border-r border-slate-200 bg-white flex flex-col min-h-0">
            <div className="p-3 border-b border-slate-200 space-y-2">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher nom, téléphone, plaque…"
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
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className={clsx(
                        'w-full text-left px-4 py-3 hover:bg-slate-50 transition',
                        selectedId === c.id && 'bg-brand-50',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <PresenceDot presence={c.presence} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {c.fullName ?? '—'}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            {c.phone}
                            {c.plate && <> · {c.plate}</>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-slate-500">
                            {presenceLabel(c.presence)}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {formatLastSeen(c.last_seen)}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Map */}
          <div className="flex-1 min-h-0">
            <CaptainsMap
              captains={data ?? []}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatChip({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
      <span className={clsx('w-2 h-2 rounded-full', dot)} />
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-semibold text-slate-900">{value}</span>
    </div>
  );
}

function PresenceDot({ presence }: { presence: Captain['presence'] }) {
  const color =
    presence === 'on_ride' ? 'bg-orange-500'
    : presence === 'online' ? 'bg-emerald-500'
    : presence === 'paused' ? 'bg-slate-400'
    : 'bg-slate-300';
  const ring =
    presence === 'online' || presence === 'on_ride' ? 'ring-2 ring-offset-2 ring-emerald-100' : '';
  return <span className={clsx('w-2.5 h-2.5 rounded-full shrink-0', color, ring)} />;
}

function presenceLabel(p: Captain['presence']): string {
  if (p === 'on_ride') return 'En course';
  if (p === 'online') return 'En ligne';
  if (p === 'paused') return 'En pause';
  return 'Hors ligne';
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
