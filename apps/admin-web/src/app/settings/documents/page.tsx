/**
 * /settings/documents — à quel moment du parcours chaque document devient
 * bloquant.
 *
 * L'interrupteur « obligatoire / facultatif » d'avant ne savait pas dire
 * « obligatoire, mais après l'acceptation ». C'est pourtant ce dont dépend
 * l'onboarding v3 : ne demander avant le "oui" que ce qui sert à dire oui, et
 * réclamer le reste au captain une fois qu'il est accepté et motivé.
 *
 * Déplacer un document vers « Candidature » rallonge d'autant le parcours
 * d'inscription — c'est le seul réglage de cette page qui coûte des candidats.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { DOCUMENT_LABELS, DOCUMENT_TYPES, type DocumentType } from '@/lib/types';

type DocumentStage = 'application' | 'online' | 'off';

interface DocumentRequirement {
  type: DocumentType;
  stage: DocumentStage;
  updatedAt: string;
  updatedBy: string | null;
}

const STAGES: { value: DocumentStage; label: string; hint: string }[] = [
  { value: 'application', label: 'Candidature', hint: 'Bloque l’envoi du dossier et sa validation' },
  { value: 'online', label: 'Mise en ligne', hint: 'Le Captain est validé, mais ne peut pas rouler' },
  { value: 'off', label: 'Non requis', hint: 'Envoyable, ne bloque rien' },
];

export default function DocumentRequirementsPage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['document-requirements'],
    queryFn: async () => {
      const r = await api.get<DocumentRequirement[]>('/admin/document-requirements');
      return r.data;
    },
  });

  const setStage = useMutation({
    mutationFn: async (input: { type: DocumentType; stage: DocumentStage }) => {
      const r = await api.put<DocumentRequirement>(
        `/admin/document-requirements/${input.type}`,
        { stage: input.stage },
      );
      return r.data;
    },
    onSuccess: (updated) => {
      qc.setQueryData<DocumentRequirement[]>(['document-requirements'], (prev) =>
        prev?.map((r) => (r.type === updated.type ? updated : r)) ?? prev,
      );
    },
  });

  const byType = new Map((data ?? []).map((r) => [r.type, r] as const));

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Documents requis</h1>
          <p className="text-sm text-slate-500 mt-1">
            Choisissez à quel moment chaque document devient bloquant. Ce qui est
            exigé dès la candidature allonge l&apos;inscription et fait perdre des
            candidats&nbsp;: n&apos;y laissez que ce qui sert à décider si la
            personne peut conduire.
          </p>
        </div>

        <div className="card p-4 mb-5 bg-slate-50 text-xs text-slate-600 space-y-1">
          {STAGES.map((s) => (
            <div key={s.value}>
              <span className="font-medium text-slate-800">{s.label}</span> — {s.hint}
            </div>
          ))}
        </div>

        {isLoading && <div className="card p-5 text-slate-500">Chargement…</div>}
        {error && <div className="card p-5 text-red-600">Erreur de chargement</div>}

        {data && (
          <div className="card divide-y divide-slate-200">
            {DOCUMENT_TYPES.map((type) => {
              const row = byType.get(type);
              const stage = row?.stage ?? 'off';
              const pending = setStage.isPending && setStage.variables?.type === type;
              return (
                <div
                  key={type}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="text-sm font-medium text-slate-900">
                    {DOCUMENT_LABELS[type]}
                  </div>
                  <select
                    className="input w-48"
                    value={stage}
                    disabled={pending}
                    onChange={(e) =>
                      setStage.mutate({ type, stage: e.target.value as DocumentStage })
                    }
                  >
                    {STAGES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
