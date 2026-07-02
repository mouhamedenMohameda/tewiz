/**
 * /partners — partner program directory (agencies, restaurants, members).
 *
 *   - List partners with type/status filters and current-month earnings.
 *   - Create a partner with per-type contract terms (share of OUR commission
 *     in %, end conditions). Optionally issues a login account whose
 *     one-time password is revealed once (same UX as user creation).
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { formatMru, type PartnerStatus, type PartnerType } from '@tewiz/shared-types';
import {
  PARTNER_STATUS_LABEL,
  PARTNER_TYPE_LABEL,
  partnerStatusBadge,
  partnerTypeBadge,
} from './shared';

interface PartnerListRow {
  id: string;
  type: PartnerType;
  name: string;
  phone: string | null;
  code: string;
  status: PartnerStatus;
  shareBps: number;
  monthTotalMru: number;
  monthCount: number;
  createdAt: string;
}

export default function PartnersPage() {
  const qc = useQueryClient();
  const canAct = useCan('ops_manager', 'finance');
  const [typeFilter, setTypeFilter] = useState<PartnerType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<PartnerStatus | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [reveal, setReveal] = useState<{ name: string; phone: string; password: string } | null>(null);

  const list = useQuery<PartnerListRow[]>({
    queryKey: ['admin-partners', typeFilter, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const r = await api.get(`/admin/partners?${params.toString()}`);
      return r.data as PartnerListRow[];
    },
    refetchInterval: 30_000,
  });

  const columns: Column<PartnerListRow>[] = [
    {
      key: 'name',
      header: 'Partenaire',
      mobilePrimary: true,
      cell: (p) => (
        <Link href={`/partners/${p.id}`} className="font-medium text-emerald-700 hover:underline">
          {p.name}
        </Link>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      cell: (p) => <span className="font-mono text-slate-600">{p.code}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (p) => (
        <span className={`px-2 py-1 text-xs rounded-md font-medium ${partnerTypeBadge(p.type)}`}>
          {PARTNER_TYPE_LABEL[p.type]}
        </span>
      ),
    },
    {
      key: 'share',
      header: 'Part commission',
      cell: (p) => <span className="text-slate-700">{(p.shareBps / 100).toFixed(1)} %</span>,
    },
    {
      key: 'month',
      header: 'Gains du mois',
      cell: (p) => (
        <span className="text-slate-900 font-medium">
          {formatMru(p.monthTotalMru)}
          <span className="text-slate-400 text-xs"> · {p.monthCount} lignes</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (p) => (
        <span className={`px-2 py-1 text-xs rounded-md font-medium ${partnerStatusBadge(p.status)}`}>
          {PARTNER_STATUS_LABEL[p.status]}
        </span>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Partenaires</h1>
            <p className="text-sm text-slate-500">
              Agences, restaurants et membres — partage de commission plateforme.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/partners/settlements"
              className="px-4 py-2.5 rounded-lg font-medium text-sm border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              Règlements
            </Link>
            <Link
              href="/partners/fraud"
              className="px-4 py-2.5 rounded-lg font-medium text-sm border border-amber-300 text-amber-700 hover:bg-amber-50"
            >
              Fraude
            </Link>
            {canAct && (
              <button
                onClick={() => setShowCreate(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm"
              >
                + Nouveau partenaire
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 mb-4">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as PartnerType | 'all')}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Tous les types</option>
            <option value="agency">Agences</option>
            <option value="restaurant">Restaurants</option>
            <option value="individual">Membres</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PartnerStatus | 'all')}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actifs</option>
            <option value="suspended">Suspendus</option>
            <option value="ended">Terminés</option>
          </select>
        </div>

        {list.isLoading && <div className="text-slate-500">Chargement...</div>}
        {list.error && <div className="text-red-600">Erreur de chargement.</div>}

        {list.data && (
          <ResponsiveTable
            data={list.data}
            columns={columns}
            rowKey={(p) => p.id}
            emptyMessage="Aucun partenaire pour l'instant."
          />
        )}

        {showCreate && (
          <CreatePartnerModal
            onClose={() => setShowCreate(false)}
            onCreated={(payload) => {
              setShowCreate(false);
              qc.invalidateQueries({ queryKey: ['admin-partners'] });
              if (payload.password) {
                setReveal({ name: payload.name, phone: payload.phone, password: payload.password });
              }
            }}
          />
        )}
        {reveal && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-bold mb-1">Mot de passe du compte partenaire</h2>
              <p className="text-sm text-slate-500 mb-4">
                Envoyez-le à {reveal.name} (<span className="font-mono">{reveal.phone}</span>).
                Il ne sera plus affiché.
              </p>
              <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 text-center mb-4">
                <div className="font-mono text-2xl font-bold tracking-widest text-slate-900 select-all">
                  {reveal.password}
                </div>
              </div>
              <button
                onClick={() => setReveal(null)}
                className="w-full px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
              >
                J'ai terminé
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Create partner modal — terms pre-filled per type.
// ---------------------------------------------------------------------------

const DEFAULT_TERMS: Record<PartnerType, {
  shareBps: number;
  windowMonths?: number;
  windowMaxCourses?: number;
  closureBonusMru?: number;
  quotaCourses?: number;
  quotaMonths?: number;
  conversionBonusMru?: number;
}> = {
  agency:     { shareBps: 1500, windowMonths: 12, windowMaxCourses: 300, closureBonusMru: 500 },
  restaurant: { shareBps: 2000 },
  individual: { shareBps: 1500, quotaCourses: 100, quotaMonths: 6, conversionBonusMru: 200 },
};

function CreatePartnerModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (p: { name: string; phone: string; password: string | null }) => void;
}) {
  const [type, setType] = useState<PartnerType>('agency');
  const [name, setName] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [terms, setTerms] = useState(DEFAULT_TERMS.agency);
  const [error, setError] = useState<string | null>(null);

  function switchType(t: PartnerType) {
    setType(t);
    setTerms(DEFAULT_TERMS[t]);
  }

  const submit = useMutation({
    mutationFn: async () => {
      setError(null);
      const r = await api.post('/admin/partners', {
        type,
        name,
        ...(userPhone.trim() ? { userPhone: userPhone.trim() } : {}),
        ...terms,
      });
      return r.data as { partnerPassword: string | null };
    },
    onSuccess: (data) =>
      onCreated({ name, phone: userPhone, password: data.partnerPassword }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      setError(e.response?.data?.error?.message ?? 'Erreur lors de la création.');
    },
  });

  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 my-8">
        <h2 className="text-lg font-bold mb-1">Nouveau partenaire</h2>
        <p className="text-sm text-slate-500 mb-4">
          Les termes sont figés dans le contrat du partenaire (modifiables ensuite).
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => switchType(e.target.value as PartnerType)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="agency">Agence de livraison (côté chauffeurs)</option>
              <option value="restaurant">Restaurant (crée des courses)</option>
              <option value="individual">Membre particulier (crée des courses)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Nom</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === 'agency' ? 'Agence Sahel Express' : 'Pizza Lina'}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">
              Téléphone du compte de connexion (optionnel)
            </label>
            <input
              type="tel"
              value={userPhone}
              onChange={(e) => setUserPhone(e.target.value)}
              placeholder="+22245XXXXXXX"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <p className="mt-1 text-xs text-slate-500">
              Crée (ou lie) le compte avec lequel le partenaire se connecte
              et lance ses courses. Nouveau compte → mot de passe affiché une fois.
            </p>
          </div>

          <div>
            <label className="block text-xs text-slate-600 mb-1">
              Part de la commission plateforme (%)
            </label>
            <input
              type="number" min={0} max={50} step={0.5}
              value={terms.shareBps / 100}
              onChange={(e) => setTerms({ ...terms, shareBps: Math.round(num(e.target.value) * 100) })}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {type === 'agency' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Fenêtre (mois)</label>
                <input
                  type="number" min={1}
                  value={terms.windowMonths ?? 12}
                  onChange={(e) => setTerms({ ...terms, windowMonths: num(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Max courses</label>
                <input
                  type="number" min={1}
                  value={terms.windowMaxCourses ?? 300}
                  onChange={(e) => setTerms({ ...terms, windowMaxCourses: num(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Prime clôture (MRU)</label>
                <input
                  type="number" min={0}
                  value={terms.closureBonusMru ?? 0}
                  onChange={(e) => setTerms({ ...terms, closureBonusMru: num(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {type === 'individual' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Quota courses</label>
                <input
                  type="number" min={1}
                  value={terms.quotaCourses ?? 100}
                  onChange={(e) => setTerms({ ...terms, quotaCourses: num(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Quota (mois)</label>
                <input
                  type="number" min={1}
                  value={terms.quotaMonths ?? 6}
                  onChange={(e) => setTerms({ ...terms, quotaMonths: num(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Prime conversion (MRU)</label>
                <input
                  type="number" min={0}
                  value={terms.conversionBonusMru ?? 0}
                  onChange={(e) => setTerms({ ...terms, conversionBonusMru: num(e.target.value) })}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {type === 'agency' && (
            <p className="text-xs text-slate-500 bg-blue-50 border border-blue-100 rounded-lg p-2">
              Chaque livreur apporté ouvre une fenêtre de gain : l'agence touche
              sa part pendant {terms.windowMonths ?? 12} mois OU jusqu'aux{' '}
              {terms.windowMaxCourses ?? 300} premières courses du livreur
              (premier atteint). Une seule fenêtre par livreur, à vie.
            </p>
          )}
          {type === 'individual' && (
            <p className="text-xs text-slate-500 bg-teal-50 border border-teal-100 rounded-lg p-2">
              Le membre touche sa part sur ses {terms.quotaCourses ?? 100} premières
              courses complétées OU pendant {terms.quotaMonths ?? 6} mois (premier
              atteint), plus une prime quand un de ses clients commande seul.
            </p>
          )}
        </div>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Annuler
          </button>
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || name.trim().length < 2}
            className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            {submit.isPending ? 'Création…' : 'Créer le partenaire'}
          </button>
        </div>
      </div>
    </div>
  );
}
