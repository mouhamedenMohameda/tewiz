import { pool } from '../../db/pool.js';

/**
 * Current terms & conditions version.
 *
 * Bumping this string invalidates every stored acceptance: new captains are
 * blocked at submit time and existing captains hit the full-screen gate on
 * their next app launch. Keep it in sync with `TERMS_VERSION` in
 * apps/mobile/lib/terms.ts — the client sends the version it displayed and the
 * server refuses anything that isn't the current one, so a stale build can
 * never record a consent for text it didn't show.
 */
export const TERMS_VERSION = '2026-07-28';

/** Date the current version takes effect (display only). */
export const TERMS_EFFECTIVE_DATE = '2026-07-28';

export interface TermsStatus {
  version: string;
  effectiveDate: string;
  accepted: boolean;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  locale: string | null;
}

/** Has this user accepted the *current* terms version? */
export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM captain_terms_acceptances
      WHERE user_id = $1 AND terms_version = $2
      LIMIT 1`,
    [userId, TERMS_VERSION],
  );
  return r.rowCount! > 0;
}

/**
 * Current status for a user: the version they must accept plus the most recent
 * acceptance on record (any version), so the client can tell "never accepted"
 * apart from "accepted an older version".
 */
export async function getTermsStatus(userId: string): Promise<TermsStatus> {
  const r = await pool.query<{
    terms_version: string;
    locale: string;
    accepted_at: Date;
  }>(
    `SELECT terms_version, locale, accepted_at
       FROM captain_terms_acceptances
      WHERE user_id = $1
      ORDER BY accepted_at DESC
      LIMIT 1`,
    [userId],
  );
  const last = r.rows[0];
  return {
    version: TERMS_VERSION,
    effectiveDate: TERMS_EFFECTIVE_DATE,
    accepted: !!last && last.terms_version === TERMS_VERSION,
    acceptedAt: last ? last.accepted_at.toISOString() : null,
    acceptedVersion: last?.terms_version ?? null,
    locale: last?.locale ?? null,
  };
}

/**
 * Record a consent. Idempotent: accepting twice keeps the first timestamp,
 * which is the one that matters legally.
 */
export async function acceptTerms(
  userId: string,
  input: { locale: string; appVersion?: string | null; platform?: string | null },
): Promise<TermsStatus> {
  await pool.query(
    `INSERT INTO captain_terms_acceptances (user_id, terms_version, locale, app_version, platform)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, terms_version) DO NOTHING`,
    [userId, TERMS_VERSION, input.locale, input.appVersion ?? null, input.platform ?? null],
  );
  return await getTermsStatus(userId);
}
