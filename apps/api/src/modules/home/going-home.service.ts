import { pool, withTx } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error.js';
import { getBalance } from '../wallet/wallet.service.js';
import type { GoingHomeStatus } from '@tewiz/shared-types';

interface SessionRow {
  id: string;
  captain_id: string;
  home_lat: number;
  home_lng: number;
  started_at: Date;
  ended_at: Date | null;
  status: GoingHomeStatus;
  end_reason: string | null;
}

function shape(r: SessionRow) {
  return {
    id: r.id,
    captainId: r.captain_id,
    home: { lat: r.home_lat, lng: r.home_lng },
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status,
    endReason: r.end_reason,
  };
}

const SESSION_COLS = `
  id, captain_id,
  ST_Y(home_snapshot::geometry) AS home_lat,
  ST_X(home_snapshot::geometry) AS home_lng,
  started_at, ended_at, status, end_reason
`;

export async function getActiveSession(captainId: string) {
  const r = await pool.query<SessionRow>(
    `SELECT ${SESSION_COLS} FROM captain_going_home_sessions
      WHERE captain_id = $1 AND status = 'active' LIMIT 1`,
    [captainId],
  );
  return r.rows[0] ? shape(r.rows[0]) : null;
}

/**
 * Start a going-home session.
 * Requirements:
 *   - Captain has a home
 *   - Captain is online (not offline / on_ride)
 *   - Balance OK (same gate as going-online)
 *   - Has not exceeded GOING_HOME_MAX_PER_DAY
 *   - No other active session
 */
export async function startSession(captainId: string) {
  return withTx(async (client) => {
    const home = await client.query<{ home_lat: number; home_lng: number }>(
      `SELECT ST_Y(location::geometry) AS home_lat,
              ST_X(location::geometry) AS home_lng
         FROM captain_home WHERE captain_id = $1`,
      [captainId],
    );
    if (!home.rows[0]) {
      throw new HttpError(409, 'no_home', 'Set your home address first');
    }

    const state = await client.query<{ presence: string }>(
      `SELECT presence FROM captain_state WHERE captain_id = $1`,
      [captainId],
    );
    if (state.rows[0]?.presence !== 'online') {
      throw new HttpError(409, 'not_online',
        'Must be online (and not on a ride) to start going-home mode');
    }

    const balance = await getBalance(captainId);
    if (balance < env.MIN_BALANCE_TO_GO_ONLINE_KHOUMS) {
      throw new HttpError(402, 'balance_too_low', 'Insufficient balance');
    }

    const todayCount = await client.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM captain_going_home_sessions
        WHERE captain_id = $1
          AND started_at > date_trunc('day', now() AT TIME ZONE 'Africa/Nouakchott') AT TIME ZONE 'Africa/Nouakchott'`,
      [captainId],
    );
    if (Number(todayCount.rows[0]?.n ?? 0) >= env.GOING_HOME_MAX_PER_DAY) {
      throw new HttpError(429, 'daily_limit',
        `Limit ${env.GOING_HOME_MAX_PER_DAY} going-home sessions per day reached`);
    }

    const ins = await client.query<SessionRow>(
      `INSERT INTO captain_going_home_sessions
         (captain_id, home_snapshot, status)
       VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 'active')
       RETURNING ${SESSION_COLS}`,
      [captainId, home.rows[0]!.home_lng, home.rows[0]!.home_lat],
    );
    return shape(ins.rows[0]!);
  });
}

interface EndSessionInput {
  captainId: string;
  reason: 'cancelled' | 'completed' | 'expired';
  note?: string;
}

export async function endSession(input: EndSessionInput) {
  const r = await pool.query<SessionRow>(
    `UPDATE captain_going_home_sessions
        SET status = $1, ended_at = now(), end_reason = $2
      WHERE captain_id = $3 AND status = 'active'
   RETURNING ${SESSION_COLS}`,
    [input.reason, input.note ?? input.reason, input.captainId],
  );
  if (!r.rows[0]) throw new HttpError(404, 'no_active_session', 'No active session');
  return shape(r.rows[0]);
}

/**
 * Expire any session running for more than env.GOING_HOME_SESSION_MAX_HOURS,
 * or that arrived home (within env.GOING_HOME_ARRIVAL_RADIUS_M).
 *
 * Intended to be called by a periodic job. In Phase 5 we expose it via admin
 * endpoint and call it from the captain state-update flow.
 */
export async function reapStaleSessions() {
  // Auto-expire by timeout
  await pool.query(
    `UPDATE captain_going_home_sessions
        SET status = 'expired', ended_at = now(), end_reason = 'timeout'
      WHERE status = 'active'
        AND started_at < now() - ($1 || ' hours')::interval`,
    [env.GOING_HOME_SESSION_MAX_HOURS],
  );

  // Auto-complete if captain is within arrival radius of home for last update
  await pool.query(
    `UPDATE captain_going_home_sessions s
        SET status = 'completed', ended_at = now(), end_reason = 'arrived'
       FROM captain_state cs
      WHERE s.status = 'active'
        AND s.captain_id = cs.captain_id
        AND cs.location IS NOT NULL
        AND ST_DWithin(cs.location, s.home_snapshot, $1)`,
    [env.GOING_HOME_ARRIVAL_RADIUS_M],
  );
}
