'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type RideStatus =
  | 'pending_passenger_confirm' | 'searching'
  | 'accepted' | 'arrived' | 'in_progress'
  | 'completed' | 'cancelled_by_rider' | 'cancelled_by_captain'
  | 'cancelled_by_system' | 'no_show';

type RideType = 'passenger' | 'colis';

interface Ride {
  id: string;
  rideType: RideType;
  status: RideStatus;
  passengerName: string | null;
  passengerPhone: string | null;
  isForOther: boolean;
  captainId: string | null;
  pickup: { lat: number; lng: number; label: string | null };
  dropoff: { lat: number; lng: number; label: string | null };
  fareEstimateMru: number | null;
  fareFinalMru: number | null;
  commissionMru: number | null;
  paymentMethod: 'cash' | 'wallet';
  verificationCode?: string;
  requestedAt: string;
  acceptedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

const STATUS_LABEL: Record<RideStatus, string> = {
  pending_passenger_confirm: 'Confirmation passager en attente',
  searching: 'Recherche d\'un chauffeur',
  accepted: 'Acceptée — chauffeur en route',
  arrived: 'Chauffeur arrivé',
  in_progress: 'Course en cours',
  completed: 'Terminée',
  cancelled_by_rider: 'Annulée par le client',
  cancelled_by_captain: 'Annulée par le chauffeur',
  cancelled_by_system: 'Annulée par le système',
  no_show: 'Passager absent',
};

const STATUS_COLOR: Record<RideStatus, string> = {
  pending_passenger_confirm: 'bg-amber-100 text-amber-800',
  searching: 'bg-blue-100 text-blue-800',
  accepted: 'bg-indigo-100 text-indigo-800',
  arrived: 'bg-violet-100 text-violet-800',
  in_progress: 'bg-cyan-100 text-cyan-800',
  completed: 'bg-green-100 text-green-800',
  cancelled_by_rider: 'bg-rose-100 text-rose-800',
  cancelled_by_captain: 'bg-rose-100 text-rose-800',
  cancelled_by_system: 'bg-slate-200 text-slate-700',
  no_show: 'bg-rose-100 text-rose-800',
};

function fmtMru(mru: number | null): string {
  if (mru == null) return '—';
  return `${Math.round(mru).toLocaleString('fr-FR')} MRU`;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function RideDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: ride, isLoading, error } = useQuery({
    queryKey: ['admin-ride', id],
    queryFn: async () => {
      const r = await api.get<Ride>(`/admin/rides/${id}`);
      return r.data;
    },
    // Live updates as the captain accepts / arrives / completes.
    refetchInterval: 4_000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 text-slate-500">Chargement…</div>
      </AppShell>
    );
  }

  if (error || !ride) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-rose-600">Course introuvable.</p>
          <Link href="/rides/new" className="text-blue-600 underline mt-2 inline-block">
            ‹ Nouvelle course
          </Link>
        </div>
      </AppShell>
    );
  }

  const timeline: { label: string; time: string | null }[] = [
    { label: 'Demandée', time: ride.requestedAt },
    { label: 'Acceptée', time: ride.acceptedAt },
    { label: 'Chauffeur arrivé', time: ride.arrivedAt },
    { label: 'Démarrée', time: ride.startedAt },
    { label: 'Terminée', time: ride.completedAt },
  ];

  const isFinal =
    ride.status === 'completed' ||
    ride.status.startsWith('cancelled') ||
    ride.status === 'no_show';

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Course #{ride.id.slice(0, 8)}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {ride.rideType === 'colis' ? '📦 Colis' : '🚖 Passager'}
              {' · '}
              Demandée à {fmtTime(ride.requestedAt)}
            </p>
          </div>
          <Link href="/rides/new" className="text-sm text-blue-600 hover:underline">
            + Nouvelle course
          </Link>
        </div>

        <div className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${STATUS_COLOR[ride.status]}`}>
          {!isFinal ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
            </span>
          ) : null}
          {STATUS_LABEL[ride.status]}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Trip */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Trajet
            </h2>
            <div className="space-y-3">
              <div>
                <div className="text-xs text-slate-500">Départ</div>
                <div className="text-sm text-slate-900">
                  {ride.pickup.label ?? `${ride.pickup.lat.toFixed(5)}, ${ride.pickup.lng.toFixed(5)}`}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Destination</div>
                <div className="text-sm text-slate-900">
                  {ride.dropoff.label ?? `${ride.dropoff.lat.toFixed(5)}, ${ride.dropoff.lng.toFixed(5)}`}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between text-sm">
              <span className="text-slate-500">Tarif estimé</span>
              <span className="font-semibold text-slate-900">{fmtMru(ride.fareEstimateMru)}</span>
            </div>
            {ride.fareFinalMru != null ? (
              <div className="mt-1 flex justify-between text-sm">
                <span className="text-slate-500">Tarif final</span>
                <span className="font-semibold text-emerald-700">{fmtMru(ride.fareFinalMru)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-slate-500">Paiement</span>
              <span className="text-slate-900">{ride.paymentMethod === 'cash' ? 'Espèces' : 'Wallet'}</span>
            </div>
          </div>

          {/* People */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Personnes
            </h2>
            <div>
              <div className="text-xs text-slate-500">Passager</div>
              <div className="text-sm text-slate-900">
                {ride.passengerName ?? '—'}
                {ride.passengerPhone ? <span className="text-slate-500"> · {ride.passengerPhone}</span> : null}
              </div>
            </div>
            <div className="mt-3">
              <div className="text-xs text-slate-500">Chauffeur</div>
              <div className="text-sm text-slate-900">
                {ride.captainId ? (
                  <span>Assigné · <code className="text-xs">{ride.captainId.slice(0, 8)}</code></span>
                ) : (
                  <span className="text-slate-400">En attente d'acceptation</span>
                )}
              </div>
            </div>
            {ride.verificationCode ? (
              <div className="mt-4 p-3 rounded-lg bg-yellow-50 border border-yellow-200">
                <div className="text-xs font-semibold text-yellow-800">Code vérification</div>
                <div className="text-2xl font-bold tracking-widest text-yellow-900 mt-1">
                  {ride.verificationCode}
                </div>
                <div className="text-xs text-yellow-700 mt-1">
                  À communiquer au passager pour qu'il puisse confirmer son identité au chauffeur.
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Timeline */}
        <div className="card p-5 mt-6">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Chronologie
          </h2>
          <ol className="space-y-2">
            {timeline.map((step) => (
              <li key={step.label} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${step.time ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className={step.time ? 'text-slate-900' : 'text-slate-400'}>{step.label}</span>
                </div>
                <span className={step.time ? 'font-mono text-slate-700' : 'text-slate-300'}>
                  {fmtTime(step.time)}
                </span>
              </li>
            ))}
            {ride.cancelledAt ? (
              <li className="flex items-center justify-between text-sm pt-2 border-t border-slate-100">
                <div className="flex items-center gap-3">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-rose-700">Annulée · {ride.cancelReason ?? 'sans raison'}</span>
                </div>
                <span className="font-mono text-rose-700">{fmtTime(ride.cancelledAt)}</span>
              </li>
            ) : null}
          </ol>

          {!isFinal ? (
            <p className="mt-4 text-xs text-slate-400">
              Mise à jour automatique toutes les 4 secondes.
            </p>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
