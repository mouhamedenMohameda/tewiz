/**
 * /partners/fraud — frozen (on_hold) partner earnings with the triggering
 * signal. Admin decides: release (back to pending) or cancel. Suspicious
 * money is frozen by the periodic scan, never silently deleted.
 */

'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { formatMru, type PartnerEarningRole } from '@tewiz/shared-types';
import { EARNING_ROLE_LABEL } from '../shared';

interface HeldEarning {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerCode: string;
  rideId: string;
  role: PartnerEarningRole;
  amountMru: number;
  holdReason: string | null;
  createdAt: string;
  ride: { completedAt: string | null; distanceM: number | null; pickupLabel: string | null; dropoffLabel: string | null };
}

export default function PartnerFraudPage() {
  const qc = useQueryClient();
  const canAct = useCan('ops_manager', 'finance');

  const list = useQuery<HeldEarning[]>({
    queryKey: ['admin-partner-fraud'],
    queryFn: async () =>
      (await api.get('/admin/partners/earnings?status=on_hold&limit=500')).data,
    refetchInterval: 30_000,
  });

  const scan = useMutation({
    mutationFn: async () => (await api.post('/admin/partners/fraud-scan')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partner-fraud'] }),
  });

  const moderate = useMutation({
    mutationFn: async (input: { id: string; status: 'pending' | 'cancelled' }) => {
      await api.patch(`/admin/partners/earnings/${input.id}`, { status: input.status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partner-fraud'] }),
  });

  const columns: Column<HeldEarning>[] = [
    {
      key: 'partner',
      header: 'Partenaire',
      mobilePrimary: true,
      cell: (e) => (
        <Link href={`/partners/${e.partnerId}`} className="font-medium text-emerald-700 hover:underline">
          {e.partnerName} <span className="text-slate-400 font-mono text-xs">{e.partnerCode}</span>
        </Link>
      ),
    },
    {
      key: 'signal',
      header: 'Signal',
      cell: (e) => (
        <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 inline-block">
          {e.holdReason ?? 'gel manuel'}
        </span>
      ),
    },
    {
      key: 'ride',
      header: 'Course',
      hideOnMobile: true,
      cell: (e) => (
        <Link href={`/rides/${e.rideId}`} className="text-xs text-emerald-700 hover:underline">
          {e.ride.pickupLabel ?? '?'} → {e.ride.dropoffLabel ?? '?'}
          {e.ride.distanceM != null && (
            <span className="text-slate-400"> · {(e.ride.distanceM / 1000).toFixed(1)} km</span>
          )}
        </Link>
      ),
    },
    {
      key: 'role',
      header: 'Type',
      hideOnMobile: true,
      cell: (e) => <span className="text-xs">{EARNING_ROLE_LABEL[e.role]}</span>,
    },
    {
      key: 'amount',
      header: 'Montant',
      cell: (e) => <span className="font-medium">{formatMru(e.amountMru)}</span>,
    },
    ...(canAct
      ? [{
          key: 'actions',
          header: 'Décision',
          align: 'right' as const,
          cell: (e: HeldEarning) => (
            <div className="flex justify-end gap-2">
              <button
                onClick={() => moderate.mutate({ id: e.id, status: 'pending' })}
                disabled={moderate.isPending}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
              >
                Valider
              </button>
              <button
                onClick={() => moderate.mutate({ id: e.id, status: 'cancelled' })}
                disabled={moderate.isPending}
                className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50"
              >
                Annuler
              </button>
            </div>
          ),
        }]
      : []),
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Fraude partenaires</h1>
            <p className="text-sm text-slate-500">
              Gains gelés par le scan (paires récurrentes, courses trop courtes,
              rafales de création). Valider remet le gain en attente de paiement.
            </p>
          </div>
          {canAct && (
            <button
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
              className="px-4 py-2.5 rounded-lg font-medium text-sm border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            >
              {scan.isPending ? 'Scan…' : 'Lancer le scan maintenant'}
            </button>
          )}
        </div>

        {list.isLoading && <div className="text-slate-500">Chargement...</div>}
        {list.error && <div className="text-red-600">Erreur de chargement.</div>}

        {list.data && (
          <ResponsiveTable
            data={list.data}
            columns={columns}
            rowKey={(e) => e.id}
            emptyMessage="Aucun gain gelé — rien à modérer. ✨"
          />
        )}
      </div>
    </AppShell>
  );
}
