import type { TFunction } from 'i18next';
import { formatMru } from './format';

/**
 * The API sends `balance_too_low` with a French-only message (min/actual
 * hardcoded server-side). Rebuild a localized message client-side from
 * `error.details` instead of showing the raw backend string.
 */
export function balanceTooLowMessage(e: any, t: TFunction): string | null {
  const code = e?.response?.data?.error?.code;
  if (code !== 'balance_too_low') return null;
  const details = e?.response?.data?.error?.details;
  if (typeof details?.minRequired !== 'number' || typeof details?.balance !== 'number') return null;
  return t('captainAlert.balanceTooLow', {
    min: formatMru(details.minRequired),
    balance: formatMru(details.balance),
  });
}

/**
 * Error codes whose server text is not fit to show as-is — it is written in a
 * single language, server-side. We translate those client-side instead.
 */
const CODE_KEYS: Record<string, string> = {
  application_exists: 'becomeCaptain.errApplicationExists',
  already_captain: 'becomeCaptain.errAlreadyCaptain',
  phone_required: 'becomeCaptain.errPhoneRequired',
};

/**
 * The message to show when an API call fails.
 *
 * The API only writes user-facing text for 4xx; a 5xx carries the generic
 * English "Something went wrong", which is neither translated nor actionable.
 * So: a translation when we recognise the error code, the server text for the
 * remaining 4xx, and a localized fallback for everything else — 5xx, timeouts
 * and no-network, which are the cases the captain used to see in English.
 */
export function apiErrorMessage(e: any, t: TFunction, fallback?: string): string {
  const res = e?.response;
  // No response at all: offline, DNS failure, or the axios timeout.
  if (!res) return t('errors.network');
  const err = res.data?.error;
  const key = err?.code ? CODE_KEYS[err.code] : undefined;
  if (key) return t(key);
  if (res.status >= 400 && res.status < 500) {
    const m = err?.message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback ?? t('errors.server');
}
