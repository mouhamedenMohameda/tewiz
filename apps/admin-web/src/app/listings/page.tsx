'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

interface ListingCategory {
  category: string;
  label: string;
  enabled: boolean;
  publicationFeeMru: number;
}

interface AdminListing {
  id: string;
  category: string;
  title: string;
  priceMru: number;
  priceUnit: string;
  providerName: string;
  providerPhone?: string;
  publicationFeeMru: number;
  windowDays: number;
  viewsCount: number;
  status: 'active' | 'expired' | 'cancelled';
  publishedUntil: string;
  createdAt: string;
}

interface AdminStats {
  totalListings: number;
  activeListings: number;
  totalRevenueMru: number;
  avgViews: number;
}

interface AdminListingsResponse {
  listings: AdminListing[];
  stats: AdminStats;
  categories: ListingCategory[];
}

const STATUS_STYLE: Record<AdminListing['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-rose-100 text-rose-700',
};

function formatMru(v: number): string {
  return `${Math.round(v).toLocaleString('fr-FR')} MRU`;
}

export default function AdminListingsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<AdminListingsResponse>({
    queryKey: ['admin-listings'],
    queryFn: async () => (await api.get<AdminListingsResponse>('/admin/listings')).data,
  });

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold text-slate-900 mb-1">Annonces</h1>
        <p className="text-sm text-slate-500 mb-6">
          Marketplace de services (modèle Ervdni) : le prestataire paie un forfait pour publier,
          l&apos;acheteur voit son numéro. Activez/désactivez chaque catégorie et fixez le forfait.
        </p>

        {isLoading || !data ? (
          <p className="text-slate-500">Chargement…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
              <StatCard label="Annonces totales" value={String(data.stats.totalListings)} />
              <StatCard label="Actives" value={String(data.stats.activeListings)} />
              <StatCard label="Revenu publications" value={formatMru(data.stats.totalRevenueMru)} />
              <StatCard label="Vues moyennes" value={data.stats.avgViews.toFixed(1)} />
            </div>

            <h2 className="font-semibold text-slate-900 mb-3">Catégories</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
              {data.categories.map((c) => (
                <CategoryRow key={c.category} category={c} onSaved={() => qc.invalidateQueries({ queryKey: ['admin-listings'] })} />
              ))}
            </div>

            <h2 className="font-semibold text-slate-900 mb-3">Annonces publiées</h2>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left p-3">Titre</th>
                    <th className="text-left p-3">Catégorie</th>
                    <th className="text-left p-3">Prestataire</th>
                    <th className="text-right p-3">Prix</th>
                    <th className="text-right p-3">Vues</th>
                    <th className="text-center p-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {data.listings.length === 0 ? (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-400">Aucune annonce.</td></tr>
                  ) : data.listings.map((l) => (
                    <tr key={l.id} className="border-t border-slate-100">
                      <td className="p-3 font-medium text-slate-800">{l.title}</td>
                      <td className="p-3 text-slate-600">{l.category}</td>
                      <td className="p-3 text-slate-600">
                        {l.providerName}{l.providerPhone ? ` · ${l.providerPhone}` : ''}
                      </td>
                      <td className="p-3 text-right">{formatMru(l.priceMru)}</td>
                      <td className="p-3 text-right">{l.viewsCount}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[l.status]}`}>
                          {l.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4 border border-slate-200 rounded-lg bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold text-slate-900 mt-1">{value}</div>
    </div>
  );
}

function CategoryRow({ category, onSaved }: { category: ListingCategory; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(category.enabled);
  const [fee, setFee] = useState(String(category.publicationFeeMru));

  const mutation = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/listings/categories/${category.category}`, {
        enabled,
        publication_fee_mru: parseInt(fee, 10),
      });
    },
    onSuccess: onSaved,
  });

  const dirty = enabled !== category.enabled || parseInt(fee, 10) !== category.publicationFeeMru;

  return (
    <div className="flex items-center justify-between gap-3 border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-emerald-600"
          />
          <span className="font-medium text-slate-800">{category.label}</span>
        </label>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-24 border border-slate-300 rounded px-2 py-1 text-right"
          />
          <span className="text-xs text-slate-500">MRU</span>
        </div>
        <button
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="px-3 py-1 rounded bg-slate-900 text-white text-sm disabled:opacity-40"
        >
          {mutation.isPending ? '…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
