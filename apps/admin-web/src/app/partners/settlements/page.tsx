/**
 * /partners/settlements — monthly payouts across every partner.
 * Generation happens from the partner detail page (period picker there);
 * this page is the global view: drafts to pay, history.
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { formatMru, type PartnerSettlementStatus } from '@tewiz/shared-types';

interface SettlementRow {
  id: string;
  partnerId: string;
  partnerName: string;
  partnerCode: string;
  periodStart: string;
  periodEnd: string;
  totalMru: number;
  status: PartnerSettlementStatus;
  paidAt: string | null;
  note: string | null;
  createdAt: string;
}

export default function PartnerSettlementsPage() {
  const qc = useQueryClient();
  const canAct = useCan('ops_manager', 'finance');
  const [statusFilter, setStatusFilter] = useState<PartnerSettlementStatus | 'all'>('all');

  const list = useQuery<SettlementRow[]>({
    queryKey: ['admin-partner-settlements-all', statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      return (await api.get(`/admin/partners/settlements?${params.toString()}`)).data;
    },
    refetchInterval: 30_000,
  });

  const pay = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/admin/partners/settlements/${id}/pay`);
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['admin-partner-settlements-all'] }),
  });

  const columns: Column<SettlementRow>[] = [
    {
      key: 'partner',
      header: 'Partenaire',
      mobilePrimary: true,
      cell: (s) => (
        <Link href={`/partners/${s.partnerId}`} className="font-medium text-emerald-700 hover:underline">
          {s.partnerName} <span className="text-slate-400 font-mono text-xs">{s.partnerCode}</span>
        </Link>
      ),
    },
    {
      key: 'period',
      header: 'Période',
      cell: (s) => (
        <span className="text-xs text-slate-600">
          {new Date(s.periodStart).toLocaleDateString('fr-FR')} →{' '}
          {new Date(s.periodEnd).toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      cell: (s) => <span className="font-semibold">{formatMru(s.totalMru)}</span>,
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (s) => s.status === 'paid' ? (
        <span className="px-2 py-1 text-xs rounded-md font-medium bg-emerald-100 text-emerald-700">
          Payé {s.paidAt ? `· ${new Date(s.paidAt).toLocaleDateString('fr-FR')}` : ''}
        </span>
      ) : (
        <span className="px-2 py-1 text-xs rounded-md font-medium bg-amber-100 text-amber-700">
          Brouillon
        </span>
      ),
    },
    ...(canAct
      ? [{
          key: 'actions',
          header: 'Actions',
          align: 'right' as const,
          hideOnMobile: true,
          cell: (s: SettlementRow) => s.status === 'draft' ? (
            <button
              onClick={() => pay.mutate(s.id)}
              disabled={pay.isPending}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
            >
              Marquer payé
            </button>
          ) : null,
        }]
      : []),
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Règlements partenaires</h1>
            <p className="text-sm text-slate-500">
              Paiements mensuels — générez le règlement depuis la fiche du partenaire.
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PartnerSettlementStatus | 'all')}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Tous</option>
            <option value="draft">Brouillons</option>
            <option value="paid">Payés</option>
          </select>
        </div>

        {list.isLoading && <div className="text-slate-500">Chargement...</div>}
        {list.error && <div className="text-red-600">Erreur de chargement.</div>}

        {list.data && (
          <ResponsiveTable
            data={list.data}
            columns={columns}
            rowKey={(s) => s.id}
            emptyMessage="Aucun règlement."
          />
        )}
      </div>
    </AppShell>
  );
}
