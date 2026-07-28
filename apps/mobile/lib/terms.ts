/**
 * Captain terms & conditions consent.
 *
 * The captain must accept the current version before their KYC application can
 * be submitted. The gate exists in two places on purpose:
 *
 *  - Client side (checkbox on the become-captain screen, full-screen gate for
 *    already-approved captains) — so the captain sees *why* they're blocked.
 *  - Server side (submitApplication refuses without a consent row) — so an old
 *    build that predates this screen still cannot push documents into review.
 *
 * TERMS_VERSION must stay in sync with the constant of the same name in
 * apps/api/src/modules/captain/terms.service.ts. Bumping it invalidates every
 * previous acceptance and re-shows the gate to everyone.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { api } from './api';
import i18n from 'i18next';

export const TERMS_VERSION = '2026-07-28';

export interface TermsStatus {
  version: string;
  effectiveDate: string;
  accepted: boolean;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  locale: string | null;
}

export async function fetchTermsStatus(): Promise<TermsStatus> {
  const r = await api.get<TermsStatus>('/captain/terms/me');
  return r.data;
}

export async function acceptTerms(): Promise<TermsStatus> {
  const r = await api.post<TermsStatus>('/captain/terms/accept', {
    version: TERMS_VERSION,
    // The language the captain actually read the text in — part of the proof.
    locale: (i18n.language || 'fr').split('-')[0],
    appVersion: Application.nativeApplicationVersion ?? undefined,
    platform: Platform.OS,
  });
  return r.data;
}

/**
 * Consent state for the signed-in user. `null` while loading or when the call
 * failed — callers must treat "unknown" as "don't block", the server-side gate
 * is what actually enforces the rule.
 */
export function useTermsStatus(enabled = true) {
  const [status, setStatus] = useState<TermsStatus | null>(null);
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setStatus(await fetchTermsStatus());
    } catch {
      // Offline or an older API: stay silent and let the server decide at
      // submit time rather than locking the captain out of the app.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { status, loading, reload, setStatus };
}
