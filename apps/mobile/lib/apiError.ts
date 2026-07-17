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
