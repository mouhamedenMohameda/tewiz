'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import clsx from 'clsx';

type StatusFilter = 'active' | 'done' | 'all';
type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

interface RideRow {
  id: string;
  rideType: 'passenger' | 'colis';
  status: RideStatus;
  passengerName: string | null;
  passengerPhone: string | null;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  commissionMru: number | null;
  paymentMethod: 'cash' | 'wallet';
  requestedAt: string;
  completedAt?: string | null;
}

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'En cours' },
  { value: 'done',   label: 'Terminées' },
  { value: 'all',    label: 'Toutes' },
];

function fmtMru(mru: number | null) {
  if (mru == null) return '—';
  return `${Math.round(mru).toLocaleString('fr-FR')} MRU`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_PILL: Record<RideStatus, { label: string; cls: string }> = {
  pending_passenger_confirm: { label: 'Attente passager',  cls: 'bg-amber-100  text-amber-800' },
  searching:                 { label: 'Recherche',          cls: 'bg-blue-100   text-blue-800' },
  accepted:                  { label: 'Acceptée',           cls: 'bg-indigo-100 text-indigo-800' },
  arrived:                   { label: 'Arrivé',             cls: 'bg-indigo-100 text-indigo-800' },
  in_progress:               { label: 'En cours',           cls: 'bg-emerald-100 text-emerald-800' },
  completed:                 { label: 'Terminée',           cls: 'bg-green-100  text-green-800' },
  cancelled_by_rider:        { label: 'Annulée (passager)', cls: 'bg-rose-100   text-rose-800' },
  cancelled_by_captain:      { label: 'Annulée (chauffeur)', cls: 'bg-rose-100  text-rose-800' },
  cancelled_by_system:       { label: 'Annulée (système)',  cls: 'bg-rose-100   text-rose-800' },
  no_show:                   { label: 'No-show',            cls: 'bg-slate-200  text-slate-700' },
};

export default function RidesPage() {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [busyId, setBusyId] = useState<string | null>(null);

  const rebroadcast = useMutation({
    mutationFn: async (rideId: string) => {
      const r = await api.post<{ captainsNotified: number }>(
        `/admin/rides/${rideId}/rebroadcast`,
      );
      return r.data;
    },
    onMutate: (rideId) => setBusyId(rideId),
    onSettled: () => setBusyId(null),
    onSuccess: (data) => {
      alert(
        data.captainsNotified > 0
          ? `Course relancée — ${data.captainsNotified} chauffeur${data.captainsNotified > 1 ? 's' : ''} notifié${data.captainsNotified > 1 ? 's' : ''}.`
          : 'Aucun chauffeur en ligne à proximité.',
      );
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? 'Échec de la relance';
      alert(msg);
    },
  });

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['rides', filter],
    queryFn: async () => {
      const params = filter === 'all' ? '' : `?status=${filter}`;
      const r = await api.get<RideRow[]>(`/admin/rides${params}`);
      return r.data;
    },
    // Active rides change second-by-second; the operator wants live status.
    refetchInterval: filter === 'active' ? 5_000 : false,
  });

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-900">Courses</h1>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-sm text-brand-700 hover:text-brand-900 disabled:opacity-50"
          >
            ↻ Rafraîchir
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Suivi de toutes les courses — opération en temps réel pour les actives,
          archive consultable pour les terminées.
        </p>

        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition -mb-px',
                filter === f.value ? 'border-brand-600 text-brand-700'
                                   : 'border-transparent text-slate-600 hover:text-slate-900',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-slate-500 text-sm">Chargement…</div>
        ) : (data?.length ?? 0) === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500 text-sm">
            Aucune course dans cette catégorie.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Demandée</th>
                  <th className="text-left px-4 py-3 font-semibold">Type</th>
                  <th className="text-left px-4 py-3 font-semibold">Passager</th>
                  <th className="text-left px-4 py-3 font-semibold">Trajet</th>
                  <th className="text-left px-4 py-3 font-semibold">Tarif</th>
                  <th className="text-left px-4 py-3 font-semibold">Commission</th>
                  <th className="text-left px-4 py-3 font-semibold">État</th>
                  <th className="text-right px-4 py-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data!.map((r) => {
                  const pill = STATUS_PILL[r.status];
                  return (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        <Link href={`/rides/${r.id}`} className="text-brand-700 hover:underline">
                          {fmtTime(r.requestedAt)}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {r.rideType === 'colis' ? '📦' : '🚖'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div className="font-medium">{r.passengerName ?? '—'}</div>
                        <div className="text-xs text-slate-500">{r.passengerPhone ?? ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-md">
                        <div className="text-xs">
                          <span className="text-slate-400">de </span>
                          {r.pickup.label ?? `${r.pickup.lat.toFixed(3)}, ${r.pickup.lng.toFixed(3)}`}
                        </div>
                        <div className="text-xs">
                          <span className="text-slate-400">vers </span>
                          {r.dropoff.label ?? `${r.dropoff.lat.toFixed(3)}, ${r.dropoff.lng.toFixed(3)}`}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">
                          {fmtMru(r.fareFinalMru ?? r.fareEstimateMru)}
                        </div>
                        <div className="text-xs text-slate-400">
                          {r.paymentMethod === 'cash' ? 'Espèces' : 'Wallet'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                        {fmtMru(r.commissionMru)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
                          pill.cls,
                        )}>
                          {pill.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {r.status === 'searching' ? (
                          <button
                            onClick={() => rebroadcast.mutate(r.id)}
                            disabled={busyId === r.id}
                            className="text-xs font-medium px-3 py-1.5 rounded-md bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:opacity-50"
                          >
                            {busyId === r.id ? 'Relance…' : '↻ Relancer'}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
