'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import type { TopupListItem, TopupStatus } from '@/lib/types';
import clsx from 'clsx';

const STATUSES: { value: TopupStatus; label: string }[] = [
  { value: 'pending', label: 'À traiter' },
  { value: 'approved', label: 'Approuvés' },
  { value: 'partial', label: 'Partiels' },
  { value: 'rejected', label: 'Refusés' },
];

function fmtMru(khoums: number) {
  return `${(khoums / 5).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MRU`;
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

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Recharges Bankily / Masrivi</h1>
        <p className="text-sm text-slate-500 mb-6">
          Vérifie la capture du chauffeur contre ton compte Bankily/Masrivi avant d'approuver.
        </p>

        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition -mb-px',
                status === s.value ? 'border-brand-600 text-brand-700'
                                   : 'border-transparent text-slate-600 hover:text-slate-900',
              )}
            >{s.label}</button>
          ))}
        </div>

        {isLoading && <div className="text-slate-500">Chargement...</div>}

        {data && data.length === 0 && (
          <div className="card p-8 text-center text-slate-500">Aucune recharge {status}.</div>
        )}

        {data && data.length > 0 && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Chauffeur</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Fournisseur</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Ref</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-700">Montant</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Reçu le</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.captain.fullName ?? '—'}</div>
                      <div className="text-xs text-slate-500">{t.captain.phone}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{t.provider}</td>
                    <td className="px-4 py-3 font-mono text-xs">{t.referenceCode}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {fmtMru(t.claimedAmountKhoums)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(t.createdAt).toLocaleString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/topups/${t.id}`} className="btn-secondary">Examiner →</Link>
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
