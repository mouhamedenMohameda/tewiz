import { pool } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import type { RoadReportReason } from '@tewiz/shared-types';

interface ReportRow {
  id: string;
  reporter_id: string;
  reporter_role: string;
  lat: number;
  lng: number;
  radius_m: number;
  reason: RoadReportReason;
  note: string | null;
  photo_storage_key: string | null;
  reported_at: Date;
  expires_at: Date;
  confirmations: number;
  dismissals: number;
  status: string;
}

const COLS = `
  id, reporter_id, reporter_role,
  ST_Y(location::geometry) AS lat,
  ST_X(location::geometry) AS lng,
  radius_m, reason, note, photo_storage_key,
  reported_at, expires_at, confirmations, dismissals, status
`;

function shape(r: ReportRow) {
  return {
    id: r.id,
    reporterRole: r.reporter_role,
    location: { lat: r.lat, lng: r.lng },
    radiusM: r.radius_m,
    reason: r.reason,
    note: r.note,
    reportedAt: r.reported_at,
    expiresAt: r.expires_at,
    confirmations: r.confirmations,
    dismissals: r.dismissals,
    status: r.status,
  };
}

const RATE_LIMIT_PER_DAY = 5;

interface CreateInput {
  reporterId: string;
  reporterRole: 'rider' | 'captain';
  lat: number;
  lng: number;
  radiusM?: number;
  reason: RoadReportReason;
  note?: string;
}

export async function createReport(input: CreateInput) {
  // Rate-limit per user per day.
  const count = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM road_reports
      WHERE reporter_id = $1 AND reported_at > now() - interval '1 day'`,
    [input.reporterId],
  );
  if (Number(count.rows[0]?.n ?? 0) >= RATE_LIMIT_PER_DAY) {
    throw new HttpError(429, 'rate_limited',
      `Maximum ${RATE_LIMIT_PER_DAY} reports per day reached`);
  }

  // Also reject reports too close to an existing active one (within 50m), to
  // avoid spam clusters. Confirm-vote instead.
  const dup = await pool.query<{ id: string }>(
    `SELECT id FROM road_reports
      WHERE status = 'active'
        AND reason = $1
        AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 50)
      LIMIT 1`,
    [input.reason, input.lng, input.lat],
  );
  if (dup.rows[0]) {
    throw new HttpError(409, 'duplicate_nearby',
      'A similar report exists nearby — confirm it instead',
      { existingReportId: dup.rows[0].id });
  }

  const r = await pool.query<ReportRow>(
    `INSERT INTO road_reports
       (reporter_id, reporter_role, location, radius_m, reason, note, expires_at)
     VALUES ($1, $2,
             ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
             $5, $6, $7, now() + interval '6 hours')
     RETURNING ${COLS}`,
    [
      input.reporterId, input.reporterRole,
      input.lng, input.lat,
      input.radiusM ?? 50,
      input.reason, input.note ?? null,
    ],
  );
  return shape(r.rows[0]!);
}

interface ListInput {
  // Optional bounding box
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  limit?: number;
}

export async function listActive(input: ListInput = {}) {
  const limit = input.limit ?? 200;
  let sql = `SELECT ${COLS} FROM road_reports WHERE status = 'active'`;
  const params: unknown[] = [];
  if (input.minLat !== undefined && input.maxLat !== undefined
      && input.minLng !== undefined && input.maxLng !== undefined) {
    params.push(input.minLng, input.minLat, input.maxLng, input.maxLat);
    sql += ` AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography`;
  }
  params.push(limit);
  sql += ` ORDER BY confirmations DESC, reported_at DESC LIMIT $${params.length}`;
  const r = await pool.query<ReportRow>(sql, params);
  return r.rows.map(shape);
}

export async function voteReport(input: {
  reportId: string;
  userId: string;
  vote: 1 | -1;
}) {
  return await import('../../db/pool.js').then(({ withTx }) => withTx(async (client) => {
    // Check report exists and active.
    const r = await client.query<{ status: string }>(
      `SELECT status FROM road_reports WHERE id = $1 FOR UPDATE`,
      [input.reportId],
    );
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Report not found');
    if (r.rows[0].status !== 'active') {
      throw new HttpError(409, 'wrong_status', `Report is ${r.rows[0].status}`);
    }

    // Upsert vote (idempotent)
    const before = await client.query<{ vote: number }>(
      `SELECT vote FROM road_report_votes WHERE report_id = $1 AND user_id = $2`,
      [input.reportId, input.userId],
    );
    await client.query(
      `INSERT INTO road_report_votes (report_id, user_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (report_id, user_id) DO UPDATE SET vote = EXCLUDED.vote, voted_at = now()`,
      [input.reportId, input.userId, input.vote],
    );

    // Adjust counters
    const dConf = (input.vote === 1 ? 1 : 0) - (before.rows[0]?.vote === 1 ? 1 : 0);
    const dDism = (input.vote === -1 ? 1 : 0) - (before.rows[0]?.vote === -1 ? 1 : 0);

    const upd = await client.query<ReportRow>(
      `UPDATE road_reports
          SET confirmations = confirmations + $1,
              dismissals    = dismissals    + $2,
              status = CASE
                WHEN dismissals + $2 > confirmations + $1 + 1 THEN 'dismissed'::road_report_status
                ELSE status
              END
        WHERE id = $3 RETURNING ${COLS}`,
      [dConf, dDism, input.reportId],
    );
    return shape(upd.rows[0]!);
  }));
}

/**
 * Admin: remove a report (e.g. abusive).
 */
export async function adminRemove(reportId: string) {
  const r = await pool.query<ReportRow>(
    `UPDATE road_reports SET status = 'admin_removed' WHERE id = $1 RETURNING ${COLS}`,
    [reportId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Report not found');
  return shape(r.rows[0]);
}

/**
 * Cron: expire reports that have passed expires_at.
 */
export async function expireOld() {
  const r = await pool.query(
    `UPDATE road_reports SET status = 'expired'
      WHERE status = 'active' AND expires_at < now()`,
  );
  return { expired: r.rowCount ?? 0 };
}
