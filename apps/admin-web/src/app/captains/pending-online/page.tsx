/**
 * /captains/pending-online — le contrôle a posteriori des véhicules déclarés.
 *
 * ATTENTION : ce n'est pas une file d'attente. Le Captain roule déjà. On
 * l'accepte sur son permis et sa carte grise, il déclare son véhicule et part
 * aussitôt — le faire patienter ici revenait à lui imposer une seconde attente
 * juste après lui avoir dit oui, alors que l'ancien parcours le laissait
 * démarrer immédiatement.
 *
 * Ce qu'on fait donc ici : on confronte, et on suspend si ça ne colle pas.
 *
 * Le travail total baisse : les documents « pour rouler » d'un candidat recalé
 * sur son permis ne sont jamais examinés, alors qu'ils l'étaient tous d'un
 * bloc avant.
 *
 * Le contrôle qui compte : la plaque saisie par le Captain doit correspondre à
 * la carte grise. C'était impossible à rater tant qu'un opérateur recopiait le
 * document ; ça devient un écart possible dès que le Captain saisit lui-même.
 * D'où la carte grise affichée à côté de la saisie — un coup d'œil, pas une
 * enquête.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { AuthImage } from '@/components/AuthImage';
import { api } from '@/lib/api';
import { DOCUMENT_LABELS, type DocumentType } from '@/lib/types';

interface OnlineDoc {
  id: string;
  type: DocumentType;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt: string | null;
  rejectReason: string | null;
}

interface PendingRow {
  captain_id: string;
  full_name: string | null;
  phone: string | null;
  vehicle_id: string | null;
  plate: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  seats: number | null;
  vehicle_type: 'car' | 'moto' | null;
  verified_at: string | null;
  vehicle_created_at: string | null;
  application_id: string | null;
  carte_grise_doc_id: string | null;
  online_docs: OnlineDoc[];
}

export default function PendingOnlinePage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['captains-pending-online'],
    queryFn: async () => {
      const r = await api.get<PendingRow[]>('/admin/captains/pending-online');
      return r.data;
    },
  });

  const verify = useMutation({
    mutationFn: (vehicleId: string) => api.post(`/admin/vehicles/${vehicleId}/verify`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['captains-pending-online'] }),
  });

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Mise en ligne</h1>
          <p className="text-sm text-slate-500 mt-1">
            Ces Captains roulent déjà. Vérifiez que la plaque qu'ils ont
            déclarée correspond bien à leur carte grise — en cas d'écart,
            suspendez le compte depuis sa fiche.
          </p>
        </div>

        {isLoading && <div className="card p-5 text-slate-500">Chargement…</div>}
        {error && <div className="card p-5 text-red-600">Erreur de chargement</div>}
        {data?.length === 0 && (
          <div className="card p-5 text-slate-500">
            Rien à contrôler : tous les véhicules déclarés ont été confrontés
            à leur carte grise.
          </div>
        )}

        <div className="space-y-4">
          {data?.map((row) => (
            <div key={row.captain_id} className="card p-5">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="font-semibold text-slate-900">
                    {row.full_name || <span className="text-amber-600">Nom non déclaré</span>}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{row.phone ?? '—'}</div>
                </div>
                {row.application_id && (
                  <Link
                    href={`/applications/${row.application_id}`}
                    className="btn-secondary text-xs whitespace-nowrap"
                  >
                    Voir le dossier
                  </Link>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Saisie du Captain vs carte grise, côte à côte. */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Véhicule déclaré
                  </h3>
                  {row.vehicle_id ? (
                    <>
                      <dl className="text-sm space-y-1">
                        <Row label="Plaque" value={row.plate} strong />
                        <Row label="Type" value={row.vehicle_type === 'moto' ? 'Moto' : 'Voiture'} />
                        <Row label="Marque / modèle" value={`${row.brand ?? '—'} ${row.model ?? ''}`.trim()} />
                        <Row label="Année" value={row.year != null ? String(row.year) : null} />
                        <Row label="Couleur" value={row.color} />
                        <Row label="Places" value={row.seats != null ? String(row.seats) : null} />
                      </dl>
                      {row.verified_at ? (
                        <div className="mt-3 text-xs text-green-600">✓ Véhicule vérifié</div>
                      ) : (
                        <button
                          onClick={() => verify.mutate(row.vehicle_id!)}
                          disabled={verify.isPending}
                          className="btn-primary text-sm mt-3"
                        >
                          {verify.isPending ? 'Vérification…' : 'La plaque correspond — vérifier'}
                        </button>
                      )}
                      {verify.isError && (
                        <div className="mt-2 text-xs text-red-600">
                          {errorMessage(verify.error)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-sm text-amber-600">
                      Le Captain n&apos;a pas encore déclaré son véhicule.
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    Carte grise au dossier
                  </h3>
                  {row.application_id && row.carte_grise_doc_id ? (
                    <AuthImage
                      src={`/admin/applications/${row.application_id}/documents/${row.carte_grise_doc_id}/file`}
                      alt="Carte grise"
                      className="w-full rounded-lg border border-slate-200 object-contain max-h-72 bg-slate-50"
                    />
                  ) : (
                    <div className="text-sm text-slate-400">Aucune carte grise au dossier.</div>
                  )}
                </div>
              </div>

              {/* Documents placés en 'online' par les ops. Vide par défaut
                  (0089) : ils ne bloquent plus rien, ils sont listés ici pour
                  que le contrôle se fasse au même endroit. */}
              <div className="mt-5 pt-4 border-t border-slate-200">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Documents « pour rouler »
                </h3>
                {row.online_docs.length === 0 ? (
                  <div className="text-sm text-amber-600">Aucun document envoyé.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {row.online_docs.map((d) => (
                      <span
                        key={d.id}
                        className={`text-xs px-2 py-1 rounded-full ${
                          d.status === 'approved' ? 'bg-green-100 text-green-700'
                          : d.status === 'rejected' ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {DOCUMENT_LABELS[d.type]} · {statusLabel(d.status)}
                        {d.expiresAt ? ` · exp. ${d.expiresAt.slice(0, 10)}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="text-slate-500 w-32 shrink-0">{label}</dt>
      <dd className={strong ? 'font-semibold text-slate-900' : 'text-slate-800'}>
        {value || <span className="text-slate-400">—</span>}
      </dd>
    </div>
  );
}

/** Message serveur si on en a un (ex. plaque déjà prise), sinon un repli. */
function errorMessage(e: unknown): string {
  const msg = (e as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message;
  return msg || 'Échec de la vérification.';
}

function statusLabel(s: OnlineDoc['status']): string {
  return s === 'approved' ? 'validé'
    : s === 'rejected' ? 'refusé'
    : s === 'expired' ? 'expiré'
    : 'en attente';
}
