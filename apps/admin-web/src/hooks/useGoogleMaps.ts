'use client';

import { useEffect, useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from '@/lib/env';

export type MapsStatus = 'no-key' | 'loading' | 'ready' | 'error';

// Module-level singleton so the script is injected at most once across all
// mounts of the map component.
let loadPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('gmaps-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('maps-load-failed')));
      return;
    }
    const s = document.createElement('script');
    s.id = 'gmaps-js';
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}` +
      `&language=fr&region=MR&loading=async`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('maps-load-failed'));
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * Loads the Google Maps JS API once and reports readiness. Returns 'no-key'
 * (so the caller can render a graceful fallback) when no browser key is set.
 */
export function useGoogleMaps(): MapsStatus {
  const [status, setStatus] = useState<MapsStatus>(
    GOOGLE_MAPS_API_KEY ? 'loading' : 'no-key',
  );

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      setStatus('no-key');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).google?.maps) {
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    loadScript()
      .then(() => !cancelled && setStatus('ready'))
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
