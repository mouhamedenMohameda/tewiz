import crypto from 'node:crypto';
import type pg from 'pg';
import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import type { PartnerStatus, PartnerType } from '@tewiz/shared-types';

// Partner directory + contract terms. Amounts in integer MRU, rates in bps.
// The heavy lifting (earning attribution at ride completion) lives in
// attribution.service.ts; this file is CRUD + shared lookups.

export interface PartnerRow {
  id: string;
  type: PartnerType;
  name: string;
  phone: string | null;
  code: string;
  user_id: string | null;
  restaurant_id: string | null;
  status: PartnerStatus;
  share_bps: number;
  window_months: number;
  window_max_courses: number;
  closure_bonus_mru: string;
  quota_courses: number;
  quota_months: number;
  conversion_bonus_mru: string;
  created_at: Date;
  created_by: string | null;
  updated_at: Date;
}

export const PARTNER_COLUMNS = `
  id, type, name, phone, code, user_id, restaurant_id, status, share_bps,
  window_months, window_max_courses, closure_bonus_mru,
  quota_courses, quota_months, conversion_bonus_mru,
  created_at, created_by, updated_at
`;

export function shapePartner(r: PartnerRow) {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    phone: r.phone,
    code: r.code,
    userId: r.user_id,
    restaurantId: r.restaurant_id,
    status: r.status,
    shareBps: r.share_bps,
    windowMonths: r.window_months,
    windowMaxCourses: r.window_max_courses,
    closureBonusMru: Number(r.closure_bonus_mru),
    quotaCourses: r.quota_courses,
    quotaMonths: r.quota_months,
    conversionBonusMru: Number(r.conversion_bonus_mru),
    createdAt: r.created_at,
  };
}

/**
 * The partner whose LOGIN ACCOUNT is `userId`, if any. Used to resolve the
 * /partner/* dashboard and to auto-attribute rides booked by that account.
 */
export async function findPartnerByUserId(
  userId: string,
  client?: pg.PoolClient,
): Promise<PartnerRow | null> {
  const q = client ?? pool;
  const r = await q.query<PartnerRow>(
    `SELECT ${PARTNER_COLUMNS} FROM partners WHERE user_id = $1`,
    [userId],
  );
  return r.rows[0] ?? null;
}

export async function findPartnerByCode(
  code: string,
  client?: pg.PoolClient,
): Promise<PartnerRow | null> {
  const q = client ?? pool;
  const r = await q.query<PartnerRow>(
    `SELECT ${PARTNER_COLUMNS} FROM partners WHERE code = $1`,
    [code.trim()],
  );
  return r.rows[0] ?? null;
}

/** 'AGX-3F7K' style short code, retried on the (unlikely) collision. */
export function generatePartnerCode(type: PartnerType): string {
  const prefix = type === 'agency' ? 'AGX' : type === 'restaurant' ? 'RST' : 'MBR';
  // No 0/O/1/I — the code is dictated over the phone.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${prefix}-${suffix}`;
}

export interface CreatePartnerInput {
  type: PartnerType;
  name: string;
  phone?: string | null;
  code?: string | null;
  userId?: string | null;
  restaurantId?: string | null;
  shareBps: number;
  windowMonths?: number;
  windowMaxCourses?: number;
  closureBonusMru?: number;
  quotaCourses?: number;
  quotaMonths?: number;
  conversionBonusMru?: number;
  createdBy: string;
}

export async function createPartner(input: CreatePartnerInput) {
  return withTx(async (client) => {
    if (input.userId) {
      const existing = await findPartnerByUserId(input.userId, client);
      if (existing) {
        throw new HttpError(409, 'user_already_partner',
          `Ce compte est déjà lié au partenaire ${existing.name} (${existing.code})`);
      }
    }
    // Up to 5 attempts on auto-generated codes; an explicit code conflicts loudly.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = input.code?.trim() || generatePartnerCode(input.type);
      try {
        const r = await client.query<PartnerRow>(
          `INSERT INTO partners
             (type, name, phone, code, user_id, restaurant_id, share_bps,
              window_months, window_max_courses, closure_bonus_mru,
              quota_courses, quota_months, conversion_bonus_mru, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7,
                   COALESCE($8, 12), COALESCE($9, 300), COALESCE($10, 0),
                   COALESCE($11, 100), COALESCE($12, 6), COALESCE($13, 0), $14)
           RETURNING ${PARTNER_COLUMNS}`,
          [
            input.type, input.name, input.phone ?? null, code,
            input.userId ?? null, input.restaurantId ?? null, input.shareBps,
            input.windowMonths ?? null, input.windowMaxCourses ?? null,
            input.closureBonusMru ?? null,
            input.quotaCourses ?? null, input.quotaMonths ?? null,
            input.conversionBonusMru ?? null, input.createdBy,
          ],
        );
        return shapePartner(r.rows[0]!);
      } catch (e: any) {
        // 23505 = unique_violation. Retry only when WE generated the code.
        if (e?.code === '23505' && e?.constraint === 'partners_code_key' && !input.code) {
          lastErr = e;
          continue;
        }
        if (e?.code === '23505' && e?.constraint === 'partners_code_key') {
          throw new HttpError(409, 'code_taken', `Le code ${input.code} est déjà utilisé`);
        }
        throw e;
      }
    }
    throw lastErr;
  });
}

export interface UpdatePartnerPatch {
  name?: string;
  phone?: string | null;
  status?: PartnerStatus;
  userId?: string | null;
  restaurantId?: string | null;
  shareBps?: number;
  windowMonths?: number;
  windowMaxCourses?: number;
  closureBonusMru?: number;
  quotaCourses?: number;
  quotaMonths?: number;
  conversionBonusMru?: number;
}

const PATCH_COLUMNS: Record<string, string> = {
  name: 'name',
  phone: 'phone',
  status: 'status',
  userId: 'user_id',
  restaurantId: 'restaurant_id',
  shareBps: 'share_bps',
  windowMonths: 'window_months',
  windowMaxCourses: 'window_max_courses',
  closureBonusMru: 'closure_bonus_mru',
  quotaCourses: 'quota_courses',
  quotaMonths: 'quota_months',
  conversionBonusMru: 'conversion_bonus_mru',
};

export async function updatePartner(id: string, patch: UpdatePartnerPatch) {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(patch)) {
    const col = PATCH_COLUMNS[k];
    if (!col || v === undefined) continue;
    values.push(v);
    fields.push(`${col} = $${values.length}`);
  }
  if (!fields.length) {
    const r = await pool.query<PartnerRow>(
      `SELECT ${PARTNER_COLUMNS} FROM partners WHERE id = $1`, [id],
    );
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Partenaire introuvable');
    return shapePartner(r.rows[0]);
  }
  values.push(id);
  const r = await pool.query<PartnerRow>(
    `UPDATE partners SET ${fields.join(', ')}, updated_at = now()
      WHERE id = $${values.length}
      RETURNING ${PARTNER_COLUMNS}`,
    values,
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Partenaire introuvable');
  return shapePartner(r.rows[0]);
}

/**
 * Attach a courier to an agency: opens his ONE-per-life earning window.
 * `expires_at` is frozen now — later contract changes never extend it.
 *
 * Returns 'created' | 'already_linked'. Throws when the code is invalid.
 */
export async function attachCaptainToAgency(
  client: pg.PoolClient,
  captainId: string,
  agencyCode: string,
): Promise<'created' | 'already_linked'> {
  const partner = await findPartnerByCode(agencyCode, client);
  if (!partner || partner.type !== 'agency') {
    throw new HttpError(400, 'invalid_agency_code',
      `Code agence inconnu: ${agencyCode}`);
  }
  if (partner.status !== 'active') {
    throw new HttpError(400, 'agency_not_active', 'Cette agence n\'est plus active');
  }
  const ins = await client.query(
    `INSERT INTO captain_partner_links (captain_id, partner_id, expires_at)
     VALUES ($1, $2, now() + make_interval(months => $3))
     ON CONFLICT (captain_id) DO NOTHING`,
    [captainId, partner.id, partner.window_months],
  );
  return (ins.rowCount ?? 0) > 0 ? 'created' : 'already_linked';
}

/**
 * Signup-time guard: a courier identity gets ONE window for life. Called when
 * the applicant fills the agency-code field so the refusal is explicit
 * instead of a silent no-op at approval.
 */
export async function assertCaptainNeverLinked(userId: string): Promise<void> {
  const r = await pool.query(
    `SELECT 1 FROM captain_partner_links WHERE captain_id = $1`,
    [userId],
  );
  if ((r.rowCount ?? 0) > 0) {
    throw new HttpError(409, 'window_already_used',
      'Ce chauffeur a déjà bénéficié d\'une fenêtre agence (une seule par personne, à vie)');
  }
}
