'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import type { TopupListItem, TopupStatus } from '@/lib/types';
import clsx from 'clsx';

const STATUSES: { value: TopupStatus; label: string }[] = [
  { value: 'pending', label: 'À traiter' },
  { value: 'approved', label: 'Approuvés' },
  { value: 'partial', label: 'Partiels' },
  { value: 'rejected', label: 'Refusés' },
];

function fmtMru(mru: number) {
  return `${Math.round(mru).toLocaleString('fr-FR')} MRU`;
}

export default function TopupsPage() {
  const [status, setStatus] = useState<TopupStatus>('pending');

  const { data, isLoading } = useQuery({
    queryKey: ['topups', status],
    queryFn: async () => {
      const r = await api.get<TopupListItem[]>(`/admin/topups?status=${status}`);
      return r.data;
    },
  });

  const columns: Column<TopupListItem>[] = [
    {
      key: 'captain',
      header: 'Captain',
      mobilePrimary: true,
      cell: (t) => (
        <div>
          <div className="font-medium">{t.captain.fullName ?? '—'}</div>
          <div className="text-xs text-slate-500">{t.captain.phone}</div>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Fournisseur',
      cell: (t) => <span className="capitalize">{t.provider}</span>,
    },
    {
      key: 'ref',
      header: 'Ref',
      cell: (t) => <span className="font-mono text-xs break-all">{t.referenceCode}</span>,
    },
    {
      key: 'amount',
      header: 'Montant',
      align: 'right',
      cell: (t) => <span className="font-medium">{fmtMru(t.claimedAmountMru)}</span>,
    },
    {
      key: 'received',
      header: 'Reçu le',
      cell: (t) => (
        <span className="text-slate-500 text-xs">
          {new Date(t.createdAt).toLocaleString('fr-FR')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      hideOnMobile: true,
      cell: (t) => (
        <Link href={`/topups/${t.id}`} className="btn-secondary">Examiner →</Link>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Recharges Bankily / Masrivi</h1>
        <p className="text-sm text-slate-500 mb-6">
          Vérifie la capture du Captain contre ton compte Bankily/Masrivi avant d'approuver.
        </p>

        <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition -mb-px whitespace-nowrap shrink-0',
                status === s.value ? 'border-brand-600 text-brand-700'
                                   : 'border-transparent text-slate-600 hover:text-slate-900',
              )}
            >{s.label}</button>
          ))}
        </div>

        {isLoading && <div className="text-slate-500">Chargement...</div>}

        {data && (
          <ResponsiveTable
            data={data}
            columns={columns}
            rowKey={(t) => t.id}
            emptyMessage={`Aucune recharge ${status}.`}
            mobileActions={(t) => (
              <Link href={`/topups/${t.id}`} className="btn-secondary text-xs">
                Examiner →
              </Link>
            )}
          />
        )}
      </div>
    </AppShell>
  );
}
