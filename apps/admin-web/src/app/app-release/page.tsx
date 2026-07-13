/**
 * /app-release — super_admin uploader for the hosted Android build (APK).
 *
 * Upload an APK here; the server extracts the version from the APK itself and
 * hosts the binary. The public page (/download) then serves the latest build
 * to anyone, no login required.
 *
 * Access is gated to super_admin by PAGE_PERMS (see AppShell / permissions.ts).
 */

'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

interface Release {
  id: string;
  versionName: string;
  versionCode: number;
  packageName: string | null;
  sizeBytes: number;
  notes: string | null;
  createdAt: string;
  downloadUrl: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${(n / 1024).toFixed(0)} Ko`;
  return `${mb.toFixed(1)} Mo`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function extractError(e: unknown): string {
  const err = e as { response?: { data?: { error?: { message?: string; code?: string } }; status?: number }; message?: string };
  return (
    err.response?.data?.error?.message ??
    err.response?.data?.error?.code ??
    err.message ??
    'Erreur inconnue'
  );
}

export default function AppReleasePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const query = useQuery({
    queryKey: ['app-releases'],
    queryFn: async () => (await api.get<Release[]>('/admin/app-releases')).data,
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Aucun fichier sélectionné');
      const fd = new FormData();
      fd.append('file', file);
      if (notes.trim()) fd.append('notes', notes.trim());
      const r = await api.post<Release>('/admin/app-releases', fd, {
        // APKs are large and slow to upload on a Mauritanian link — disable the
        // default 15 s axios timeout for this request only.
        timeout: 0,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      return r.data;
    },
    onSuccess: () => {
      setFile(null);
      setNotes('');
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['app-releases'] });
    },
    onError: () => setProgress(null),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/app-releases/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-releases'] }),
  });

  const releases = query.data ?? [];
  const latest = releases[0];

  const publicPageUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/download` : '/download';

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Application (APK)</h1>
          <p className="text-sm text-slate-500">
            Mettez en ligne la dernière version de l&apos;application Android. La version
            est lue automatiquement depuis l&apos;APK. La page publique&nbsp;
            <a href="/download" target="_blank" className="text-brand-700 underline">/download</a>
            &nbsp;propose toujours le dernier build à tout le monde, sans connexion.
          </p>
        </div>

        {/* Public page link to share */}
        <section className="card p-4 mb-4 bg-brand-50 border-brand-200">
          <div className="text-sm font-medium text-slate-900 mb-1">Page publique de téléchargement</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-slate-200 rounded-lg px-3 py-2 font-mono break-all">
              {publicPageUrl}
            </code>
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(publicPageUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch { /* clipboard blocked — ignore */ }
              }}
            >
              {copied ? 'Copié ✓' : 'Copier'}
            </button>
          </div>
        </section>

        {/* Upload form */}
        <section className="card p-5 mb-4">
          <h2 className="font-semibold text-slate-900 mb-3">Mettre en ligne un nouveau build</h2>

          <label className="block text-sm font-medium text-slate-700 mb-1">Fichier APK</label>
          <input
            ref={fileRef}
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-700 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-brand-600 file:text-white hover:file:bg-brand-700 mb-1"
          />
          {file && (
            <p className="text-xs text-slate-500 mb-3">
              {file.name} — {formatBytes(file.size)}
            </p>
          )}

          <label className="block text-sm font-medium text-slate-700 mb-1 mt-3">
            Notes de version <span className="text-slate-400">(optionnel)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Ex. correction de bugs, nouvelles fonctionnalités…"
            className="input mb-3"
          />

          {progress !== null && (
            <div className="mb-3">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-slate-500 mt-1">Envoi… {progress}%</p>
            </div>
          )}

          {upload.isError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2 mb-3">
              {extractError(upload.error)}
            </p>
          )}

          <button
            type="button"
            disabled={!file || upload.isPending}
            onClick={() => upload.mutate()}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {upload.isPending ? 'Envoi en cours…' : 'Mettre en ligne'}
          </button>
        </section>

        {/* Current latest */}
        {query.isLoading && <div className="text-slate-500">Chargement…</div>}
        {latest && (
          <section className="card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-900">Version en ligne actuelle</h2>
              <span className="text-xs font-medium text-white bg-emerald-600 rounded-full px-2.5 py-1">
                En ligne
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-400">Version</div>
                <div className="font-semibold text-slate-900">{latest.versionName}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Build</div>
                <div className="font-mono text-slate-700">{latest.versionCode}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Taille</div>
                <div className="text-slate-700">{formatBytes(latest.sizeBytes)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Mis en ligne</div>
                <div className="text-slate-700">{formatDate(latest.createdAt)}</div>
              </div>
            </div>
            {latest.packageName && (
              <div className="text-xs text-slate-400 mt-2 font-mono">{latest.packageName}</div>
            )}
            {latest.notes && (
              <p className="text-sm text-slate-600 mt-3 whitespace-pre-wrap">{latest.notes}</p>
            )}
            <a
              href={latest.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary inline-block mt-4"
            >
              ⬇︎ Télécharger l&apos;APK
            </a>
          </section>
        )}

        {/* History */}
        {releases.length > 1 && (
          <section className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Historique</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-200">
                    <th className="py-2 pr-3">Version</th>
                    <th className="py-2 pr-3">Build</th>
                    <th className="py-2 pr-3">Taille</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r, i) => (
                    <tr key={r.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 pr-3 font-medium text-slate-900">
                        {r.versionName}
                        {i === 0 && <span className="ml-2 text-xs text-emerald-600">(actuelle)</span>}
                      </td>
                      <td className="py-2 pr-3 font-mono text-slate-600">{r.versionCode}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatBytes(r.sizeBytes)}</td>
                      <td className="py-2 pr-3 text-slate-600">{formatDate(r.createdAt)}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          disabled={del.isPending}
                          onClick={() => {
                            if (confirm(`Supprimer le build ${r.versionName} ?`)) del.mutate(r.id);
                          }}
                          className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                        >
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
