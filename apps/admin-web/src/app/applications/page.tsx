'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
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

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Dossiers chauffeurs</h1>
        <p className="text-sm text-slate-500 mb-6">
          Vérifie les candidatures, approuve ou demande des corrections.
        </p>

        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition -mb-px',
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

        {data && data.length === 0 && (
          <div className="card p-8 text-center text-slate-500">
            Aucun dossier {status}.
          </div>
        )}

        {data && data.length > 0 && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Chauffeur</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Téléphone</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Statut</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Soumis</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{a.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{a.phone}</td>
                    <td className="px-4 py-3">{statusBadge(a.status)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {a.submitted_at ? new Date(a.submitted_at).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/applications/${a.id}`} className="btn-secondary">
                        Examiner →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
