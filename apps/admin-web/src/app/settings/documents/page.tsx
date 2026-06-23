/**
 * /settings/documents — admin toggles which document types are required
 * before a captain application can be approved. Optional types can still be
 * uploaded by the captain; they are simply ignored by the approval gate.
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { DOCUMENT_LABELS, DOCUMENT_TYPES, type DocumentType } from '@/lib/types';

interface DocumentRequirement {
  type: DocumentType;
  isRequired: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export default function DocumentRequirementsPage() {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['document-requirements'],
    queryFn: async () => {
      const r = await api.get<DocumentRequirement[]>('/admin/document-requirements');
      return r.data;
    },
  });

  const toggle = useMutation({
    mutationFn: async (input: { type: DocumentType; isRequired: boolean }) => {
      const r = await api.put<DocumentRequirement>(
        `/admin/document-requirements/${input.type}`,
        { isRequired: input.isRequired },
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
            Choisissez quels documents sont obligatoires pour valider un dossier
            chauffeur. Les documents non requis peuvent toujours être envoyés,
            mais ne bloquent pas l&apos;approbation.
          </p>
        </div>

        {isLoading && <div className="card p-5 text-slate-500">Chargement…</div>}
        {error && <div className="card p-5 text-red-600">Erreur de chargement</div>}

        {data && (
          <div className="card divide-y divide-slate-200">
            {DOCUMENT_TYPES.map((type) => {
              const row = byType.get(type);
              const isRequired = row?.isRequired ?? true;
              const pending = toggle.isPending && toggle.variables?.type === type;
              return (
                <label
                  key={type}
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50"
                >
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {DOCUMENT_LABELS[type]}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {isRequired ? 'Obligatoire' : 'Facultatif'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isRequired}
                    disabled={pending}
                    onClick={() =>
                      toggle.mutate({ type, isRequired: !isRequired })
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                      isRequired ? 'bg-brand-600' : 'bg-slate-300'
                    } ${pending ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                        isRequired ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
