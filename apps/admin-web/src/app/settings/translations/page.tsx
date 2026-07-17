/**
 * /settings/translations — fix a wrong word in any language without an app
 * rebuild. Keys are fixed (seeded from apps/mobile/locales/*.json); this page
 * only edits values, grouped by namespace with a search box, one key at a
 * time: pick a key, see/edit its value in every language, click Sauvegarder.
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

const LANGS = ['fr', 'ar', 'en', 'hs', 'ff', 'wo', 'snk'] as const;
type Lang = (typeof LANGS)[number];

const LANG_LABEL: Record<Lang, string> = {
  fr: 'Français',
  ar: 'Arabe',
  en: 'Anglais',
  hs: 'Hassaniya',
  ff: 'Pulaar / Fulfulde',
  wo: 'Wolof',
  snk: 'Soninké',
};

interface KeyRow {
  key: string;
  namespace: string;
  preview: string;
}

export default function TranslationsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['admin-translations'],
    queryFn: async () => {
      const r = await api.get<{ keys: KeyRow[] }>('/admin/translations');
      return r.data.keys;
    },
  });

  const filtered = useMemo(() => {
    const rows = list.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.key.toLowerCase().includes(q) || r.preview.toLowerCase().includes(q),
    );
  }, [list.data, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, KeyRow[]>();
    for (const row of filtered) {
      const arr = map.get(row.namespace) ?? [];
      arr.push(row);
      map.set(row.namespace, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Traductions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Corrigez un mot dans une ou plusieurs langues. Les clés sont fixes :
            impossible d&apos;en ajouter ou d&apos;en supprimer depuis cette page.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <div className="card overflow-hidden flex flex-col max-h-[75vh]">
            <div className="p-3 border-b border-slate-200 shrink-0">
              <input
                type="search"
                placeholder="Rechercher une clé ou un mot…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {list.isLoading && (
                <div className="p-4 text-sm text-slate-500">Chargement…</div>
              )}
              {list.error && (
                <div className="p-4 text-sm text-red-600">Erreur de chargement.</div>
              )}
              {!list.isLoading && grouped.length === 0 && (
                <div className="p-4 text-sm text-slate-500">Aucun résultat.</div>
              )}
              {grouped.map(([namespace, rows]) => (
                <div key={namespace}>
                  <div className="px-3 py-1.5 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {namespace} · {rows.length}
                  </div>
                  {rows.map((row) => (
                    <button
                      key={row.key}
                      onClick={() => setSelectedKey(row.key)}
                      className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${
                        selectedKey === row.key ? 'bg-brand-50' : ''
                      }`}
                    >
                      <div className="text-[11px] font-mono text-slate-400 truncate">
                        {row.key}
                      </div>
                      <div className="text-sm text-slate-800 truncate">{row.preview}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            {selectedKey ? (
              <TranslationEditor
                key={selectedKey}
                translationKey={selectedKey}
                onSaved={() => qc.invalidateQueries({ queryKey: ['admin-translations'] })}
              />
            ) : (
              <div className="text-sm text-slate-500">
                Sélectionnez une clé à gauche pour l&apos;éditer.
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function TranslationEditor({
  translationKey, onSaved,
}: {
  translationKey: string;
  onSaved: () => void;
}) {
  const detail = useQuery({
    queryKey: ['admin-translation', translationKey],
    queryFn: async () => {
      const r = await api.get<{ key: string; values: Partial<Record<Lang, string>> }>(
        `/admin/translations/${translationKey}`,
      );
      return r.data.values;
    },
  });

  const [values, setValues] = useState<Partial<Record<Lang, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [mismatches, setMismatches] = useState<Lang[] | null>(null);

  useEffect(() => {
    setValues(detail.data ?? {});
    setError(null);
    setMismatches(null);
  }, [detail.data]);

  const save = useMutation({
    mutationFn: async (force: boolean) => {
      const r = await api.put(`/admin/translations/${translationKey}`, { values, force });
      return r.data;
    },
    onSuccess: () => {
      setError(null);
      setMismatches(null);
      onSaved();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const err = e.response?.data?.error;
      if (err?.code === 'placeholder_mismatch') {
        setMismatches((err.details?.mismatches ?? []) as Lang[]);
        setError(
          "Le nombre de variables ({{...}}) a changé par rapport à l'original — vérifiez avant de forcer.",
        );
      } else {
        setError(err?.message ?? 'Erreur lors de la sauvegarde.');
      }
    },
  });

  if (detail.isLoading) return <div className="text-sm text-slate-500">Chargement…</div>;
  if (detail.error) return <div className="text-sm text-red-600">Erreur de chargement.</div>;

  const original = detail.data ?? {};
  const dirty = LANGS.some((l) => (values[l] ?? '') !== (original[l] ?? ''));
  const presentLangs = LANGS.filter((l) => original[l] !== undefined);

  return (
    <div>
      <div className="text-xs font-mono text-slate-400 mb-4">{translationKey}</div>
      <div className="space-y-4">
        {presentLangs.map((lang) => {
          const flagged = mismatches?.includes(lang);
          return (
            <div key={lang}>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                {LANG_LABEL[lang]}
                {flagged && (
                  <span className="ml-2 text-amber-600">
                    ⚠ variables différentes de l&apos;original
                  </span>
                )}
              </label>
              <textarea
                rows={2}
                value={values[lang] ?? ''}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [lang]: e.target.value }));
                  setMismatches(null);
                  setError(null);
                }}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                className={`w-full border rounded-lg px-3 py-2 text-sm ${
                  flagged ? 'border-amber-400 bg-amber-50' : 'border-slate-300'
                }`}
              />
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center justify-between gap-3">
          <span>{error}</span>
          {mismatches && (
            <button
              onClick={() => save.mutate(true)}
              className="shrink-0 underline font-medium whitespace-nowrap"
            >
              Sauvegarder quand même
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => save.mutate(false)}
          disabled={!dirty || save.isPending}
          className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
        >
          {save.isPending ? 'Enregistrement…' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  );
}
