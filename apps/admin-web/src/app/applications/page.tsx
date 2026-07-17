'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import type { ApplicationListItem, ApplicationStatus } from '@/lib/types';
import clsx from 'clsx';

const STATUSES: { value: ApplicationStatus; label: string }[] = [
  { value: 'submitted', label: 'À traiter' },
  { value: 'under_review', label: 'En cours' },
  { value: 'needs_correction', label: 'Corrections' },
  { value: 'approved', label: 'Approuvés' },
  { value: 'rejected', label: 'Refusés' },
];

function statusBadge(s: ApplicationStatus) {
  const map: Record<ApplicationStatus, string> = {
    draft: 'badge-neutral',
    submitted: 'badge-pending',
    under_review: 'badge-info',
    needs_correction: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
  };
  return <span className={map[s]}>{s}</span>;
}

export default function ApplicationsPage() {
  const [status, setStatus] = useState<ApplicationStatus>('submitted');

  const { data, isLoading, error } = useQuery({
    queryKey: ['applications', status],
    queryFn: async () => {
      const r = await api.get<ApplicationListItem[]>(`/admin/applications?status=${status}`);
      return r.data;
    },
  });

  const columns: Column<ApplicationListItem>[] = [
    {
      key: 'name',
      header: 'Captain',
      mobilePrimary: true,
      cell: (a) => <span className="font-medium">{a.full_name ?? '—'}</span>,
    },
    {
      key: 'phone',
      header: 'Téléphone',
      cell: (a) => <span className="text-slate-600 font-mono">{a.phone}</span>,
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (a) => statusBadge(a.status),
    },
    {
      key: 'submitted',
      header: 'Soumis',
      cell: (a) => (
        <span className="text-slate-500 text-xs">
          {a.submitted_at ? new Date(a.submitted_at).toLocaleString('fr-FR') : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      hideOnMobile: true,
      cell: (a) => (
        <Link href={`/applications/${a.id}`} className="btn-secondary">
          Examiner →
        </Link>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Dossiers Captains</h1>
        <p className="text-sm text-slate-500 mb-6">
          Vérifie les candidatures, approuve ou demande des corrections.
        </p>

        <div className="flex gap-1 mb-6 border-b border-slate-200 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition -mb-px whitespace-nowrap shrink-0',
                status === s.value
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {isLoading && <div className="text-slate-500">Chargement...</div>}
        {error ? (
          <div className="card p-4 text-red-600">Erreur: {String(error)}</div>
        ) : null}

        {data && (
          <ResponsiveTable
            data={data}
            columns={columns}
            rowKey={(a) => a.id}
            emptyMessage={`Aucun dossier ${status}.`}
            mobileActions={(a) => (
              <Link
                href={`/applications/${a.id}`}
                className="btn-secondary text-xs"
              >
                Examiner →
              </Link>
            )}
          />
        )}
      </div>
    </AppShell>
  );
}
