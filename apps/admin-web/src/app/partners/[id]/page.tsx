/**
 * /partners/[id] — partner detail with tabs:
 *   - Infos & termes (editable terms + suspension)
 *   - Livreurs rattachés (agency windows: X/300 courses, expiry)
 *   - Gains (earning lines)
 *   - Règlements (settlement history + generation)
 */

'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import {
  formatMru,
  type PartnerEarningRole,
  type PartnerEarningStatus,
  type PartnerStatus,
  type PartnerType,
} from '@tewiz/shared-types';
import {
  EARNING_ROLE_LABEL,
  EARNING_STATUS_LABEL,
  PARTNER_STATUS_LABEL,
  PARTNER_TYPE_LABEL,
  earningStatusBadge,
  partnerStatusBadge,
  partnerTypeBadge,
} from '../shared';

interface LinkRow {
  captainId: string;
  captainName: string | null;
  captainPhone: string | null;
  attachedAt: string;
  expiresAt: string;
  coursesCounted: number;
  coursesMax: number;
  closedAt: string | null;
  closureBonusPaid: boolean;
}

interface PartnerDetail {
  id: string;
  type: PartnerType;
  name: string;
  phone: string | null;
  code: string;
  userId: string | null;
  restaurantId: string | null;
  status: PartnerStatus;
  shareBps: number;
  windowMonths: number;
  windowMaxCourses: number;
  closureBonusMru: number;
  quotaCourses: number;
  quotaMonths: number;
  conversionBonusMru: number;
  createdAt: string;
  links: LinkRow[];
  earningsByStatus: Partial<Record<PartnerEarningStatus, { totalMru: number; count: number }>>;
}

interface EarningRow {
  id: string;
  rideId: string;
  role: PartnerEarningRole;
  baseCommissionMru: number;
  shareBps: number;
  amountMru: number;
  status: PartnerEarningStatus;
  holdReason: string | null;
  createdAt: string;
  ride: { completedAt: string | null; pickupLabel: string | null; dropoffLabel: string | null };
}

interface SettlementRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalMru: number;
  status: 'draft' | 'paid';
  paidAt: string | null;
  note: string | null;
}

type Tab = 'infos' | 'links' | 'earnings' | 'settlements';

export default function PartnerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canAct = useCan('ops_manager', 'finance');
  const [tab, setTab] = useState<Tab>('infos');

  const detail = useQuery<PartnerDetail>({
    queryKey: ['admin-partner', id],
    queryFn: async () => (await api.get(`/admin/partners/${id}`)).data,
    refetchInterval: 30_000,
  });

  const p = detail.data;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'infos', label: 'Infos & termes' },
    ...(p?.type === 'agency' ? [{ key: 'links' as Tab, label: `Livreurs (${p.links.length})` }] : []),
    { key: 'earnings', label: 'Gains' },
    { key: 'settlements', label: 'Règlements' },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <Link href="/partners" className="text-sm text-slate-500 hover:text-slate-800">
          ← Partenaires
        </Link>

        {detail.isLoading && <div className="text-slate-500 mt-4">Chargement...</div>}
        {detail.error && <div className="text-red-600 mt-4">Erreur de chargement.</div>}

        {p && (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2 mb-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  {p.name}
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${partnerTypeBadge(p.type)}`}>
                    {PARTNER_TYPE_LABEL[p.type]}
                  </span>
                  <span className={`px-2 py-1 text-xs rounded-md font-medium ${partnerStatusBadge(p.status)}`}>
                    {PARTNER_STATUS_LABEL[p.status]}
                  </span>
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  Code <span className="font-mono font-medium">{p.code}</span>
                  {p.phone ? <> · {p.phone}</> : null}
                  {' · '}créé le {new Date(p.createdAt).toLocaleDateString('fr-FR')}
                </p>
              </div>
              <div className="flex gap-4 text-sm">
                {(['pending', 'on_hold', 'settled'] as PartnerEarningStatus[]).map((s) => (
                  <div key={s} className="text-right">
                    <div className="text-xs text-slate-500">{EARNING_STATUS_LABEL[s]}</div>
                    <div className="font-semibold text-slate-900">
                      {formatMru(p.earningsByStatus[s]?.totalMru ?? 0)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-b border-slate-200 mb-4 flex gap-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px ${
                    tab === t.key
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'infos' && (
              <InfosTab
                partner={p}
                canAct={canAct}
                onSaved={() => qc.invalidateQueries({ queryKey: ['admin-partner', id] })}
              />
            )}
            {tab === 'links' && <LinksTab links={p.links} />}
            {tab === 'earnings' && <EarningsTab partnerId={p.id} canAct={canAct} />}
            {tab === 'settlements' && (
              <SettlementsTab
                partnerId={p.id}
                canAct={canAct}
                onChanged={() => qc.invalidateQueries({ queryKey: ['admin-partner', id] })}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function InfosTab({
  partner, canAct, onSaved,
}: {
  partner: PartnerDetail;
  canAct: boolean;
  onSaved: () => void;
}) {
  const [sharePct, setSharePct] = useState(String(partner.shareBps / 100));
  const [status, setStatus] = useState<PartnerStatus>(partner.status);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      await api.patch(`/admin/partners/${partner.id}`, {
        shareBps: Math.round(Number(sharePct) * 100),
        status,
      });
    },
    onSuccess: onSaved,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => setError(e.response?.data?.error?.message ?? 'Erreur.'),
  });

  const terms: [string, string][] = partner.type === 'agency'
    ? [
        ['Fenêtre par livreur', `${partner.windowMonths} mois ou ${partner.windowMaxCourses} courses`],
        ['Prime de clôture', formatMru(partner.closureBonusMru)],
      ]
    : partner.type === 'individual'
    ? [
        ['Quota', `${partner.quotaCourses} courses ou ${partner.quotaMonths} mois`],
        ['Prime de conversion', formatMru(partner.conversionBonusMru)],
      ]
    : [['Condition de fin', 'Aucune — extinction naturelle (client final autonome)']];

  return (
    <div className="max-w-lg space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Termes du contrat</h3>
        {terms.map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-900 font-medium">{v}</span>
          </div>
        ))}
        <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-100">
          <span className="text-slate-500">Part de la commission plateforme</span>
          {canAct ? (
            <span className="flex items-center gap-1">
              <input
                type="number" min={0} max={50} step={0.5}
                value={sharePct}
                onChange={(e) => setSharePct(e.target.value)}
                className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm text-right"
              />
              %
            </span>
          ) : (
            <span className="font-medium">{(partner.shareBps / 100).toFixed(1)} %</span>
          )}
        </div>
      </div>

      {canAct && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-2">Statut</h3>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PartnerStatus)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="active">Actif</option>
            <option value="suspended">Suspendu (gains stoppés, réversible)</option>
            <option value="ended">Terminé (définitif)</option>
          </select>
          <p className="mt-2 text-xs text-slate-500">
            Un partenaire suspendu ne génère plus de nouveaux gains ; les gains
            existants restent payables.
          </p>
          {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="mt-3 px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LinksTab({ links }: { links: LinkRow[] }) {
  const columns: Column<LinkRow>[] = [
    {
      key: 'captain',
      header: 'Livreur',
      mobilePrimary: true,
      cell: (l) => (
        <div>
          <div className="font-medium">{l.captainName ?? '—'}</div>
          <div className="text-xs text-slate-500 font-mono">{l.captainPhone}</div>
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Progression',
      cell: (l) => (
        <div className="min-w-[140px]">
          <div className="text-xs text-slate-600 mb-1">
            {l.coursesCounted}/{l.coursesMax} courses
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${l.closedAt ? 'bg-slate-400' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, (l.coursesCounted / l.coursesMax) * 100)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'expiry',
      header: 'Expire',
      cell: (l) => (
        <span className="text-xs text-slate-600">
          {new Date(l.expiresAt).toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'Fenêtre',
      cell: (l) => l.closedAt ? (
        <span className="px-2 py-1 text-xs rounded-md font-medium bg-slate-100 text-slate-600">
          Fermée{l.closureBonusPaid ? ' · prime versée' : ''}
        </span>
      ) : (
        <span className="px-2 py-1 text-xs rounded-md font-medium bg-emerald-100 text-emerald-700">
          Ouverte
        </span>
      ),
    },
  ];

  return (
    <ResponsiveTable
      data={links}
      columns={columns}
      rowKey={(l) => l.captainId}
      emptyMessage="Aucun livreur rattaché pour l'instant."
    />
  );
}

// ---------------------------------------------------------------------------

function EarningsTab({ partnerId, canAct }: { partnerId: string; canAct: boolean }) {
  const qc = useQueryClient();
  const list = useQuery<EarningRow[]>({
    queryKey: ['admin-partner-earnings', partnerId],
    queryFn: async () =>
      (await api.get(`/admin/partners/earnings?partnerId=${partnerId}&limit=300`)).data,
    refetchInterval: 15_000,
  });

  const moderate = useMutation({
    mutationFn: async (input: { id: string; status: 'pending' | 'on_hold' | 'cancelled' }) => {
      await api.patch(`/admin/partners/earnings/${input.id}`, { status: input.status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partner-earnings', partnerId] }),
  });

  const columns: Column<EarningRow>[] = [
    {
      key: 'date',
      header: 'Date',
      mobilePrimary: true,
      cell: (e) => (
        <span className="text-xs text-slate-600">
          {new Date(e.createdAt).toLocaleString('fr-FR')}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Type',
      cell: (e) => <span className="text-xs">{EARNING_ROLE_LABEL[e.role]}</span>,
    },
    {
      key: 'ride',
      header: 'Course',
      hideOnMobile: true,
      cell: (e) => (
        <Link href={`/rides/${e.rideId}`} className="text-xs text-emerald-700 hover:underline">
          {e.ride.pickupLabel ?? '?'} → {e.ride.dropoffLabel ?? '?'}
        </Link>
      ),
    },
    {
      key: 'amount',
      header: 'Montant',
      cell: (e) => (
        <span className="font-medium">
          {formatMru(e.amountMru)}
          {e.shareBps > 0 && (
            <span className="text-xs text-slate-400"> ({(e.shareBps / 100).toFixed(1)} % de {formatMru(e.baseCommissionMru)})</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Statut',
      cell: (e) => (
        <span
          title={e.holdReason ?? undefined}
          className={`px-2 py-1 text-xs rounded-md font-medium ${earningStatusBadge(e.status)}`}
        >
          {EARNING_STATUS_LABEL[e.status]}
        </span>
      ),
    },
    ...(canAct
      ? [{
          key: 'actions',
          header: 'Actions',
          align: 'right' as const,
          hideOnMobile: true,
          cell: (e: EarningRow) => (
            <div className="flex justify-end gap-2">
              {e.status === 'pending' && (
                <button
                  onClick={() => moderate.mutate({ id: e.id, status: 'on_hold' })}
                  className="text-xs text-amber-700 hover:text-amber-900 font-medium"
                >
                  Geler
                </button>
              )}
              {e.status === 'on_hold' && (
                <button
                  onClick={() => moderate.mutate({ id: e.id, status: 'pending' })}
                  className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
                >
                  Libérer
                </button>
              )}
              {(e.status === 'pending' || e.status === 'on_hold') && (
                <button
                  onClick={() => moderate.mutate({ id: e.id, status: 'cancelled' })}
                  className="text-xs text-red-600 hover:text-red-800 font-medium"
                >
                  Annuler
                </button>
              )}
            </div>
          ),
        }]
      : []),
  ];

  if (list.isLoading) return <div className="text-slate-500">Chargement...</div>;
  return (
    <ResponsiveTable
      data={list.data ?? []}
      columns={columns}
      rowKey={(e) => e.id}
      emptyMessage="Aucun gain pour l'instant."
    />
  );
}

// ---------------------------------------------------------------------------

function SettlementsTab({
  partnerId, canAct, onChanged,
}: {
  partnerId: string;
  canAct: boolean;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [periodStart, setPeriodStart] = useState(toDateInput(firstOfMonth));
  const [periodEnd, setPeriodEnd] = useState(toDateInput(now));
  const [error, setError] = useState<string | null>(null);

  const list = useQuery<SettlementRow[]>({
    queryKey: ['admin-partner-settlements', partnerId],
    queryFn: async () =>
      (await api.get(`/admin/partners/settlements?partnerId=${partnerId}`)).data,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-partner-settlements', partnerId] });
    onChanged();
  };

  const generate = useMutation({
    mutationFn: async () => {
      setError(null);
      await api.post(`/admin/partners/${partnerId}/settlements`, { periodStart, periodEnd });
    },
    onSuccess: invalidate,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => setError(e.response?.data?.error?.message ?? 'Erreur.'),
  });

  const pay = useMutation({
    mutationFn: async (settlementId: string) => {
      await api.post(`/admin/partners/settlements/${settlementId}/pay`);
    },
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      {canAct && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Du</label>
            <input
              type="date" value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Au (inclus)</label>
            <input
              type="date" value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            {generate.isPending ? 'Génération…' : 'Générer le règlement de la période'}
          </button>
          {error && <div className="text-sm text-red-600 w-full">{error}</div>}
        </div>
      )}

      <div className="space-y-2">
        {(list.data ?? []).map((s) => (
          <div
            key={s.id}
            className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between"
          >
            <div>
              <div className="font-medium text-slate-900">
                {new Date(s.periodStart).toLocaleDateString('fr-FR')} →{' '}
                {new Date(s.periodEnd).toLocaleDateString('fr-FR')}
              </div>
              <div className="text-xs text-slate-500">
                {s.status === 'paid'
                  ? `Payé le ${s.paidAt ? new Date(s.paidAt).toLocaleDateString('fr-FR') : ''}`
                  : 'Brouillon — en attente de paiement'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{formatMru(s.totalMru)}</span>
              {canAct && s.status === 'draft' && (
                <button
                  onClick={() => pay.mutate(s.id)}
                  disabled={pay.isPending}
                  className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
                >
                  Marquer payé
                </button>
              )}
            </div>
          </div>
        ))}
        {list.data?.length === 0 && (
          <div className="text-sm text-slate-500">Aucun règlement pour l'instant.</div>
        )}
      </div>
    </div>
  );
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}
