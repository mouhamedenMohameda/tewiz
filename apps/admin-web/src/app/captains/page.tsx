'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

// The API doesn't have a /admin/captains endpoint yet — we reuse the approved
// applications list as a captain directory. Each approved app = one captain.
export default function CaptainsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['captains'],
    queryFn: async () => {
      const r = await api.get(`/admin/applications?status=approved&limit=200`);
      return r.data as Array<{ id: string; phone: string; full_name: string | null; updated_at: string }>;
    },
  });

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Chauffeurs actifs</h1>
        <p className="text-sm text-slate-500 mb-6">
          Vue d'ensemble des chauffeurs approuvés ({data?.length ?? 0}).
        </p>

        {isLoading && <div className="text-slate-500">Chargement...</div>}

        {data && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Nom</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Téléphone</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Approuvé le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{c.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.phone}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(c.updated_at).toLocaleString('fr-FR')}
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
