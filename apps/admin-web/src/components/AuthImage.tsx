'use client';

import { useEffect, useState } from 'react';
import { fetchImage } from '@/lib/api';

/**
 * Renders an authenticated image. Fetches via axios (so the bearer token is
 * sent), wraps the blob in an object URL, and uses <img>.
 */
export function AuthImage({
  src, alt, className,
}: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null); setErr(null);

    fetchImage(src)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        objectUrl = u;
        setUrl(u);
      })
      .catch((e) => setErr(e?.message ?? 'Erreur chargement'));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (err) return <div className="text-xs text-red-600 p-2">⚠ {err}</div>;
  if (!url) return <div className="bg-slate-100 animate-pulse" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}
