/**
 * /download — PUBLIC page (no auth, no AppShell) offering the latest hosted
 * Android build (APK) to anyone. Reads GET /public/app/latest directly from the
 * API and links to GET /public/app/download for the binary.
 *
 * Uploads are managed from the admin /app-release page (super_admin only).
 */

'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/env';
import { APP_NAME } from '@/lib/brand';

interface LatestRelease {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  notes: string | null;
  createdAt: string;
  downloadUrl: string;
}

function formatBytes(n: number): string {
  const mb = n / (1024 * 1024);
  if (mb < 1) return `${(n / 1024).toFixed(0)} Ko`;
  return `${mb.toFixed(1)} Mo`;
}

function Logo({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-label={APP_NAME} className="shrink-0">
      <defs>
        <linearGradient id="dlLogoMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6A623" />
          <stop offset="0.55" stopColor="#F2682C" />
          <stop offset="1" stopColor="#D9531B" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1024" height="1024" rx="232" fill="url(#dlLogoMark)" />
      <g fill="none" stroke="#FFFCF6" strokeWidth="86" strokeLinecap="round" strokeLinejoin="round">
        <path d="M300 760 L512 286" />
        <path d="M724 760 L512 286" />
        <path d="M388 596 L636 596" />
      </g>
    </svg>
  );
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; release: LatestRelease }
  | { status: 'empty' }
  | { status: 'error' };

export default function DownloadPage() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/public/app/latest`, { cache: 'no-store' });
        if (r.status === 404) {
          if (!cancelled) setState({ status: 'empty' });
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const release = (await r.json()) as LatestRelease;
        if (!cancelled) setState({ status: 'ready', release });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="flex flex-col items-center gap-3 mb-6">
          <Logo />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{APP_NAME}</h1>
            <p className="text-sm text-slate-500 mt-1">Télécharger l&apos;application Android</p>
          </div>
        </div>

        {state.status === 'loading' && (
          <p className="text-slate-500 py-6">Chargement…</p>
        )}

        {state.status === 'error' && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            Impossible de contacter le serveur. Réessayez plus tard.
          </p>
        )}

        {state.status === 'empty' && (
          <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            Aucune version n&apos;est disponible pour le moment.
          </p>
        )}

        {state.status === 'ready' && (
          <>
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500 mb-4">
              <span className="font-semibold text-slate-900">Version {state.release.versionName}</span>
              <span>•</span>
              <span>{formatBytes(state.release.sizeBytes)}</span>
            </div>

            {state.release.notes && (
              <p className="text-sm text-slate-600 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5 text-left">
                {state.release.notes}
              </p>
            )}

            <a
              href={state.release.downloadUrl}
              className="btn-primary w-full inline-block text-center text-base py-3"
            >
              ⬇︎ Télécharger l&apos;APK
            </a>

            <p className="text-xs text-slate-400 mt-4 leading-relaxed">
              Après le téléchargement, ouvrez le fichier .apk pour l&apos;installer. Android
              peut demander d&apos;autoriser l&apos;installation depuis cette source.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
