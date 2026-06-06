'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { AuthImage } from '@/components/AuthImage';
import { api } from '@/lib/api';
import type { TopupListItem } from '@/lib/types';

function fmtMru(khoums: number) {
  return `${(khoums / 5).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MRU (${khoums} khoums)`;
}

export default function TopupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['topup', id],
    queryFn: async () => {
      const r = await api.get<TopupListItem>(`/admin/topups/${id}`);
      return r.data;
    },
  });

  const [approveAmount, setApproveAmount] = useState<number | null>(null);
  const [providerRef, setProviderRef] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const approve = useMutation({
    mutationFn: () =>
      api.post(`/admin/topups/${id}/approve`, {
        approvedAmountKhoums: approveAmount ?? data?.claimedAmountKhoums,
        providerRefNumber: providerRef || undefined,
      }),
    onSuccess: () => router.replace('/topups'),
  });

  const reject = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/topups/${id}/reject`, { reason }),
    onSuccess: () => router.replace('/topups'),
  });

  if (isLoading) return <AppShell><div className="p-6 text-slate-500">Chargement...</div></AppShell>;
  if (!data) return <AppShell><div className="p-6 text-red-600">Introuvable</div></AppShell>;

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700 mb-2">
          ← Retour
        </button>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          Recharge {data.provider} · <span className="font-mono">{data.referenceCode}</span>
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          {data.captain.fullName ?? '—'} ({data.captain.phone})
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Screenshot */}
          <div className="card p-3">
            <AuthImage
              src={`/admin/topups/${id}/screenshot`}
              alt="Reçu Bankily/Masrivi"
              className="w-full h-auto rounded"
            />
          </div>

          {/* Form */}
          <div className="space-y-4">
            <div className="card p-5">
              <h2 className="font-semibold text-slate-900 mb-3">Détails</h2>
              <dl className="space-y-2 text-sm">
                <div className="grid grid-cols-3"><dt className="text-slate-500">Code ref Tewiz</dt><dd className="col-span-2 font-mono">{data.referenceCode}</dd></div>
                <div className="grid grid-cols-3"><dt className="text-slate-500">Fournisseur</dt><dd className="col-span-2 capitalize">{data.provider}</dd></div>
                <div className="grid grid-cols-3"><dt className="text-slate-500">Ref fournisseur</dt><dd className="col-span-2 font-mono">{data.providerRefNumber ?? '—'}</dd></div>
                <div className="grid grid-cols-3"><dt className="text-slate-500">Montant déclaré</dt><dd className="col-span-2 font-semibold">{fmtMru(data.claimedAmountKhoums)}</dd></div>
                <div className="grid grid-cols-3"><dt className="text-slate-500">Statut</dt><dd className="col-span-2">{data.status}</dd></div>
              </dl>
            </div>

            {data.status === 'pending' && (
              <div className="card p-5 space-y-4">
                <h2 className="font-semibold text-slate-900">Action</h2>

                <div>
                  <label className="block text-sm text-slate-700 mb-1">
                    Montant à créditer (khoums)
                  </label>
                  <input
                    type="number"
                    className="input"
                    placeholder={String(data.claimedAmountKhoums)}
                    value={approveAmount ?? ''}
                    onChange={(e) => setApproveAmount(e.target.value ? +e.target.value : null)}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Laisse vide pour créditer le montant déclaré ({data.claimedAmountKhoums} khoums).
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-slate-700 mb-1">
                    Référence fournisseur (optionnel)
                  </label>
                  <input
                    className="input font-mono"
                    placeholder="ex: BNK-2024-0001"
                    value={providerRef}
                    onChange={(e) => setProviderRef(e.target.value)}
                  />
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-200">
                  <button onClick={() => setShowReject(true)} className="btn-danger">Refuser</button>
                  <button onClick={() => approve.mutate()} className="btn-primary flex-1">
                    {approve.isPending ? '...' : 'Approuver et créditer'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {showReject && (
          <div
            className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
            onClick={() => setShowReject(false)}
          >
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-900">Refuser la recharge</h3>
              </div>
              <div className="p-5">
                <label className="block text-sm text-slate-700 mb-1">Raison</label>
                <input
                  autoFocus className="input mb-4"
                  value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reçu non trouvé, montant différent..."
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowReject(false)} className="btn-ghost">Annuler</button>
                  <button
                    onClick={() => reject.mutate(rejectReason)}
                    disabled={rejectReason.length < 2}
                    className="btn-danger"
                  >Refuser</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
