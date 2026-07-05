'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

interface AdminCarpoolingStats {
  totalTrips: number;
  totalRevenueMru: number;
  totalBoostRevenueMru: number;
  avgViews: number;
}

interface AdminCarpoolingTrip {
  id: string;
  originCity: string;
  destinationCity: string;
  departureAt: string;
  totalSeats: number;
  availableSeats: number;
  pricePerSeatMru: number;
  driverName: string;
  driverPhone: string;
  viewsCount: number;
  status: 'active' | 'full' | 'expired' | 'cancelled';
  publicationFeeMru: number;
  boostFeeMru: number;
  isBoosted: boolean;
  createdAt: string;
}

const STATUS_LABEL: Record<AdminCarpoolingTrip['status'], string> = {
  active: 'Actif',
  full: 'Complet',
  expired: 'Expire',
  cancelled: 'Annule',
};

const STATUS_STYLE: Record<AdminCarpoolingTrip['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  full: 'bg-amber-100 text-amber-700',
  expired: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-rose-100 text-rose-700',
};

function formatMru(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} MRU`;
}

export default function AdminCarpoolingPage() {
  const statsQuery = useQuery<AdminCarpoolingStats>({
    queryKey: ['admin-carpooling-stats'],
    queryFn: async () => (await api.get<AdminCarpoolingStats>('/admin/carpooling/stats')).data,
  });

  const tripsQuery = useQuery<AdminCarpoolingTrip[]>({
    queryKey: ['admin-carpooling-trips'],
    queryFn: async () => {
      const r = await api.get<{ trips: AdminCarpoolingTrip[] }>('/admin/carpooling/trips?limit=500');
      return r.data.trips;
    },
  });

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Covoiturage inter-villes</h1>
          <p className="text-sm text-slate-500 mt-1">
            Suivi des publications, revenus et performance des trajets covoiturage.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Total trajets"
            value={statsQuery.data ? statsQuery.data.totalTrips.toLocaleString('fr-FR') : '...'}
          />
          <StatCard
            label="Revenu publications"
            value={statsQuery.data ? formatMru(statsQuery.data.totalRevenueMru) : '...'}
          />
          <StatCard
            label="Revenu boosts"
            value={statsQuery.data ? formatMru(statsQuery.data.totalBoostRevenueMru) : '...'}
          />
          <StatCard
            label="Moyenne vues / trajet"
            value={statsQuery.data ? statsQuery.data.avgViews.toFixed(1) : '...'}
          />
        </section>

        <section className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Trajets</h2>
            <span className="text-xs text-slate-500">
              {tripsQuery.data ? `${tripsQuery.data.length} lignes` : 'Chargement...'}
            </span>
          </div>

          {tripsQuery.isLoading ? (
            <div className="p-6 text-sm text-slate-500">Chargement des trajets...</div>
          ) : tripsQuery.error ? (
            <div className="p-6 text-sm text-red-600">Erreur de chargement des trajets.</div>
          ) : !tripsQuery.data || tripsQuery.data.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">Aucun trajet publie pour le moment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-left px-4 py-3 font-medium">Conducteur</th>
                    <th className="text-left px-4 py-3 font-medium">Trajet</th>
                    <th className="text-left px-4 py-3 font-medium">Places</th>
                    <th className="text-left px-4 py-3 font-medium">Prix</th>
                    <th className="text-left px-4 py-3 font-medium">Vues</th>
                    <th className="text-left px-4 py-3 font-medium">Statut</th>
                    <th className="text-left px-4 py-3 font-medium">Paye</th>
                  </tr>
                </thead>
                <tbody>
                  {tripsQuery.data.map((trip) => (
                    <tr key={trip.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-slate-900 font-medium">
                          {new Date(trip.departureAt).toLocaleDateString('fr-FR')}
                        </div>
                        <div className="text-xs text-slate-500">
                          {new Date(trip.departureAt).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-900 font-medium">{trip.driverName}</div>
                        <div className="text-xs text-slate-500">{trip.driverPhone}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-900 font-medium">
                          {trip.originCity} -&gt; {trip.destinationCity}
                        </div>
                        {trip.isBoosted ? (
                          <span className="inline-flex mt-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                            En vedette
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {trip.availableSeats}/{trip.totalSeats}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatMru(trip.pricePerSeatMru)}</td>
                      <td className="px-4 py-3 text-slate-700">{trip.viewsCount}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[trip.status]}`}>
                          {STATUS_LABEL[trip.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <div>{formatMru(trip.publicationFeeMru)}</div>
                        {trip.boostFeeMru > 0 ? (
                          <div className="text-xs text-amber-700">Boost: {formatMru(trip.boostFeeMru)}</div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}
